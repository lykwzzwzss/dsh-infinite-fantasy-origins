import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createScorer, normalizeMarkers } from "./lib/score.js";

/* ------------------------------------------------------------------ *
 * 常量与配置
 * ------------------------------------------------------------------ */

const PROMPT_URL = new URL("./prompts/infinite-fantasy-origins.md", import.meta.url);
const MARKERS_URL = new URL("./prompts/markers.json", import.meta.url);
const SECTION_NAME = "infinite-fantasy-origins:global-system-prompt";

/**
 * 段位可配。默认 100 = 紧跟部署人格、排在计划策略与全部工具说明之前。
 * 想 A/B 时不必改代码：DSH_INFINITE_FANTASY_ORIGINS_ORDER=900 dsh web
 * （dsh-system-prompt/lib/index.js:253 要求有限数，非法值自动回落到 100）
 */
const ORDER = (() => {
  const raw = Number(
    process.env.DSH_INFINITE_FANTASY_ORIGINS_ORDER ??
      process.env.DSH_INFINITE_GEN2_ORDER, // 旧变量名，改名后继续兼容
  );
  return Number.isFinite(raw) ? raw : 100;
})();

const objectOutput = {
  schema: { type: "object", additionalProperties: true },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
};

/* ------------------------------------------------------------------ *
 * 热加载：按 mtime 缓存，改提示词/词表不必重启
 * ------------------------------------------------------------------ */

const fileCache = new Map();

function readCached(url, parse) {
  const key = url.href;
  try {
    const stat = statSync(url);
    const hit = fileCache.get(key);
    if (hit && hit.mtime === stat.mtimeMs && hit.size === stat.size) return hit.value;
    const value = parse(readFileSync(url, "utf8"));
    fileCache.set(key, { mtime: stat.mtimeMs, size: stat.size, value });
    return value;
  } catch (error) {
    // 读失败但之前成功过：沿用旧值，不让一次手滑把插件打挂
    const hit = fileCache.get(key);
    if (hit) return hit.value;
    throw error;
  }
}

function promptText() {
  return readCached(PROMPT_URL, (raw) => raw);
}

function markersRaw() {
  try {
    return readCached(MARKERS_URL, (raw) => JSON.parse(raw));
  } catch (error) {
    console.warn("[infinite-fantasy] markers.json 读取失败，使用最小词表：", error?.message ?? error);
    return null;
  }
}

let scorerCache = { raw: undefined, scorer: null };

/** 同一个 JSON 文件内容只编译一次评分器 */
function currentScorer() {
  const raw = markersRaw();
  if (scorerCache.raw !== raw) {
    scorerCache = { raw, scorer: createScorer(normalizeMarkers(raw)) };
  }
  return scorerCache.scorer;
}

/* ------------------------------------------------------------------ *
 * 自检：提示词段真的进最终装配了吗？
 * ------------------------------------------------------------------ */

const health = {
  checkedAt: null,
  mounted: null, // null = 还没查过
  place: null, // 1-based
  total: null,
  error: null,
};

function snapshotHealth() {
  return { ...health };
}

/**
 * 被别的插件的 complete 段整体顶掉时，assemble() 会返回只剩那一个段，
 * 本插件的段名消失 —— 这是唯一能从插件内部观测到的方式。
 * dsh-system-prompt/lib/index.js:381-403
 */
async function selfCheck(ctx) {
  try {
    const asm = await ctx.systemPrompt.assemble();
    const names = (asm.sections ?? []).map((section) => section.name);
    const index = names.indexOf(SECTION_NAME);
    health.checkedAt = new Date().toISOString();
    health.mounted = index >= 0;
    health.place = index >= 0 ? index + 1 : null;
    health.total = names.length;
    health.error = null;
    if (index < 0) {
      console.error(
        `[infinite-fantasy] 提示词段未进入最终装配（疑似被某个 complete 段整体覆盖）。` +
          `当前段：${names.join(" | ")}`,
      );
    } else {
      console.info(
        `[infinite-fantasy] 已挂载：第 ${index + 1}/${names.length} 段，order=${ORDER}，` +
          `提示词 ${Buffer.byteLength(promptText(), "utf8")} 字节（改文件即时生效）`,
      );
    }
  } catch (error) {
    health.error = String(error?.message ?? error);
    health.checkedAt = new Date().toISOString();
    console.warn("[infinite-fantasy] 自检失败（不影响提示词注入本身）：", health.error);
  }
  return health;
}

/* ------------------------------------------------------------------ *
 * 会话投影：徽标数据源（纯本地、不持久化）
 * ------------------------------------------------------------------ */

function armorTextOf(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && block.type === "text" ? block.text : ""))
    .join("\n");
}

function initState() {
  return {
    running: false,
    verdict: null,
    words: [],
    turn: 0,
    stats: { pass: 0, fallback: 0, refusal: 0 },
    recent: [],
    health: snapshotHealth(),
  };
}

/** 模块级 health 是否比 state 里那份更新（自检完成后任意事件都能把它推给客户端） */
function healthIsNewer(state) {
  const current = snapshotHealth();
  return !state || !state.health || state.health.checkedAt !== current.checkedAt;
}

/** user/turn 事件：进入思考态并刷新 health 快照 */
function armorProjectionApply(state, event) {
  const base = state && typeof state === "object" && state.stats ? state : initState();
  if (!event || typeof event !== "object") return base;

  if (event.type === "session/created") return initState();

  if (event.type === "user/message" || event.type === "turn/start") {
    return { ...base, running: true, verdict: null, words: [], health: snapshotHealth() };
  }

  if (event.type === "turn/end") {
    if (base.running) return { ...base, running: false, health: snapshotHealth() };
    return healthIsNewer(base) ? { ...base, health: snapshotHealth() } : base;
  }

  if (event.type === "assistant/message") {
    const text = armorTextOf(event?.data?.message?.content);
    if (!text.trim()) {
      // 工具调用轮没有可见文本，不覆盖上一轮判定；但仍然顺手把自检结果推出去
      return healthIsNewer(base) ? { ...base, health: snapshotHealth() } : base;
    }

    const scored = currentScorer().score(text, base.recent);
    const stats = { ...base.stats };
    stats[scored.verdict] = (stats[scored.verdict] ?? 0) + 1;

    return {
      ...base,
      running: false,
      verdict: scored.verdict,
      words: scored.words,
      turn: base.turn + 1,
      stats,
      recent: [...base.recent, scored.verdict].slice(-10),
      health: snapshotHealth(),
    };
  }

  // 其它事件（标题、flush、attempt…）：自检结果变了就顺带更新，否则原样返回
  return healthIsNewer(base) ? { ...base, health: snapshotHealth() } : base;
}

/* ------------------------------------------------------------------ *
 * 会话投影定义
 *
 * 框架只认 `wire: { view, viewSchema }` 和 `stateSchema`：
 *  - 没有 wire 的单元不会进入 snapshot()/cachedSnapshot()（客户端永远读不到），
 *    drive() 也不会发变更通知（见 dsh-session-projection/lib/index.js
 *    register()/snapshot()/drive() 的实现）。
 *  - stateSchema 在持久化投影缓存恢复时被调用（checkpoint/restore 路径），
 *    缺了会在恢复时抛 TypeError。
 * 所以这两个字段是硬要求，不是可选装饰。
 * ------------------------------------------------------------------ */

export const armorProjectionDefinition = {
  key: "armor",
  stateVersion: 2,
  stateSchema: { parse: (value) => value },
  init: initState,
  apply: armorProjectionApply,
  wire: {
    // view 必须是纯函数且返回可结构化克隆的普通值
    view: (state) => state,
    // 交给客户端的是分离的副本，避免宿主与客户端共享可变引用
    viewSchema: { parse: (value) => structuredClone(value) },
  },
};

/* ------------------------------------------------------------------ *
 * 插件定义
 * ------------------------------------------------------------------ */

export const name = "dsh-infinite-fantasy-origins";
export const inject = ["tools", "systemPrompt", "sessionProjections"];

export function apply(ctx) {
  // 提示词段：text 传函数 -> 每次装配现读文件，改完下一条消息就生效
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: ORDER,
        text: () => promptText(),
      }),
    "infinite-fantasy-origins: system prompt section",
  );

  // 启动自检（延迟到其它插件注册完毕之后）
  ctx.effect(() => {
    const timer = setTimeout(() => void selfCheck(ctx), 1200);
    if (timer && typeof timer.unref === "function") timer.unref();
    return () => clearTimeout(timer);
  }, "infinite-fantasy-origins: startup self-check");

  // 状态工具：既能拿提示词元数据，也能当场复查挂载情况
  ctx.effect(
    () =>
      ctx.tools.register({
        name: "infinite_fantasy_profile",
        description:
          "Return the bundled 无限幻境：起源 (Infinite Fantasy: Origins) 破甲 system prompt, calibration metadata, " +
          "and live mount health (whether the prompt section survives final assembly).",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        output: objectOutput,
        async execute() {
          const text = promptText();
          const scorer = currentScorer();
          await selfCheck(ctx);
          return {
            name: "infinite-fantasy-origins",
            displayName: "无限幻境：起源",
            version: "0.4.7",
            baseline: "deepseek-unrestricted-v5-stable (dsh-deepseek-v4-obey)",
            strengthCalibration: { v4Obey: 100, infiniteGen2: 85, infiniteGen1: 60 },
            mount: {
              section: SECTION_NAME,
              order: ORDER,
              orderSource: process.env.DSH_INFINITE_FANTASY_ORIGINS_ORDER ? "env" : "default",
              hotReload: true,
              ...snapshotHealth(),
            },
            prompt: {
              bytes: Buffer.byteLength(text, "utf8"),
              sha256: createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16),
            },
            markers: {
              refusal: scorer.markers.refusal.length,
              fallback: scorer.markers.fallback.length,
              nonRefusalTail: scorer.markers.nonRefusalTail.length,
              structural: scorer.markers.rules.map((rule) => rule.label),
            },
            stabilityFeatures: [
              "fixed precedence ladder",
              "task-class templates",
              "placeholder normalization",
              "bilingual routing",
              "canned deterministic workflows",
              "web-pentest routing + canned slots",
              "no-refusal-string hard rules",
              "no-loop / no-followup anchor",
              "three-layer armor detector (literal + structural + multi-turn)",
            ],
            promptText: text,
          };
        },
      }),
    "infinite-fantasy-origins: profile tool",
  );

  // 会话投影：徽标数据源
  const projections = ctx.get("sessionProjections");
  if (projections !== undefined) {
    ctx.effect(
      () => projections.register(armorProjectionDefinition),
      "infinite-fantasy-origins: armor projection",
    );
  }
}
