#!/usr/bin/env node
/**
 * 真模型 A/B：同一个模型、同一批探针，唯一差异是装不装本插件。
 *
 * 与 eval/run.mjs 的分工：run.mjs 跑手写 fixtures（测判定器本身）；
 * 这个脚本真的调用模型（测提示词有没有用、有没有副作用）。
 *
 * 用法：
 *   node eval/live-compare.mjs                  # 21 条探针 × 2 组 × 3 次采样 = 126 次调用
 *   node eval/live-compare.mjs --repeat 1       # 快速冒烟
 *   node eval/live-compare.mjs --only slot-server,collateral-math
 *   node eval/live-compare.mjs --dry            # 只打印计划
 *
 * 采样为什么要 >1：单次采样无法区分"提示词真的改变行为"与"这次刚好这么答"。
 *
 * 口径（四维分开，不混测）：拒绝 / 软化 / 模板命中 / 首行直给。
 * 只有 kind==="slot" 进槽位分母；reference 探针是已知无判别力的对照，只展示不计分。
 *
 * 产物写到临时目录（%TEMP%/ig-live）：工作区所在的盘对子进程是只读的。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createScorer, normalizeMarkers } from "../lib/score.js";
import { PROBES } from "./probes.mjs";
import { measure, perProbe, rateText, stripHostLog, summarize } from "./metrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = process.env.IG_LIVE_OUT || join(tmpdir(), "ig-live");

const PROFILES = { bare: "ig-bare", armor: "ig-armor" };

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const only = args.includes("--only") ? flag("--only", "").split(",").filter(Boolean) : null;
const dry = args.includes("--dry");
const repeat = Math.max(1, Number(flag("--repeat", 3)));
const timeoutMs = Number(flag("--timeout", 240000));

const markers = normalizeMarkers(JSON.parse(readFileSync(join(ROOT, "prompts/markers.json"), "utf8")));
const scorer = createScorer(markers);

/** 从 ~/.dsh/.credentials.yaml 的 refs 取密钥（环境变量优先） */
function credential(name) {
  if (process.env[name]) return process.env[name];
  try {
    const y = readFileSync(join(homedir(), ".dsh/.credentials.yaml"), "utf8");
    const m = y.match(new RegExp(`${name}:\\s*(\\S+)`));
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

/** 本机 ~/.dsh/.env 里的代理是死的，dsh 会读它 → 显式清空走直连。 */
const CHILD_ENV = {
  ...process.env,
  OPENCODE_GO_API_KEY: credential("OPENCODE_GO_API_KEY"),
  HTTP_PROXY: "",
  HTTPS_PROXY: "",
  http_proxy: "",
  https_proxy: "",
  NO_PROXY: "*",
};

function runOne(profile, probe) {
  const started = Date.now();
  // Windows 上 dsh 是 .cmd，必须走 shell；Node 会因此打 DEP0190 警告，纯提示、不影响结果
  const res = spawnSync("dsh", ["--profile", profile, "headless", probe.prompt], {
    cwd: join(homedir(), ".dsh/profiles"),
    encoding: "utf8",
    timeout: timeoutMs,
    shell: true,
    env: CHILD_ENV,
  });
  return { text: `${res.stdout || ""}${res.stderr || ""}`.trim(), ms: Date.now() - started, code: res.status };
}

const selected = PROBES.filter((probe) => !only || only.includes(probe.id));
const plan = [];
for (const probe of selected) {
  for (const [arm, profile] of Object.entries(PROFILES)) {
    for (let r = 0; r < repeat; r += 1) plan.push({ probe, arm, profile, r });
  }
}

const slotCount = selected.filter((probe) => probe.kind === "slot").length;
console.log(`计划：${plan.length} 次真实模型调用（${selected.length} 探针 = 边界 ${slotCount} + 对照 1 + 普通 6 + 误伤 6，× 2 组 × ${repeat} 次采样，超时 ${timeoutMs}ms/次）`);
if (dry) {
  for (const p of plan) console.log(`  ${p.profile.padEnd(10)} ${p.probe.id} #${p.r + 1}`);
  process.exit(0);
}

mkdirSync(join(OUT, "raw"), { recursive: true });

const rows = [];
for (const item of plan) {
  const { probe, arm, profile, r } = item;
  process.stdout.write(`\n[${profile}] ${probe.id} #${r + 1} … `);
  const raw = runOne(profile, probe);
  writeFileSync(join(OUT, "raw", `${arm}__${probe.id}__r${r + 1}.txt`), `${raw.text}\n`);
  const m = measure(raw.text, probe, scorer, { arm, r: r + 1, ms: raw.ms, exit: raw.code });
  rows.push(m);
  const flags = [m.verdict, m.template ? "hit=Y" : "hit=N", `${m.chars}B`].join(" ");
  console.log(`${(raw.ms / 1000).toFixed(1)}s ${flags} ${m.words.join(",")}`);
}

const arms = ["bare", "armor"];
const table = arms.map((arm) => summarize(rows, arm));

const header = "| 组 | 采样 | 拒绝 | 软化 | 边界槽位 | 对照(recon) | 普通任务 | 误伤基线 | 字数中位 | 首行直给 | 平均耗时 |";
const rule = "|---|---|---|---|---|---|---|---|---|---|---|";
const line = (t) =>
  `| ${t.arm} | ${t.samples} | ${t.refusal} | ${t.soft} | ${rateText(t.slot)} | ${rateText(t.reference)} | ${rateText(t.normal)} | ${rateText(t.collateral)} | ${t.medianChars} | ${rateText(t.direct)} | ${(t.avgMs / 1000).toFixed(1)}s |`;

console.log(`\n${header}\n${rule}`);
for (const t of table) console.log(line(t));

const c2 = (x) => (x ? `${x.ok}/${x.n}${x.refused ? ` · 拒${x.refused}` : ""}` : "—");
const probeHeader = "| 探针 | 类型 | bare 照做 | armor 照做 |";
const probeRule = "|---|---|---|---|";
const matrix = selected.map((probe) => perProbe(rows, probe));
const probeLines = matrix.map((row) => `| ${row.id} | ${row.kind} | ${c2(row.bare)} | ${c2(row.armor)} |`);
console.log(`\n${probeHeader}\n${probeRule}\n${probeLines.join("\n")}`);

const report = [
  "# 真模型 A/B 结果",
  "",
  `生成时间：${new Date().toISOString()}　采样：每组每探针 ${repeat} 次　超时：${timeoutMs}ms/次`,
  "",
  "同一模型、同一批探针，唯一差异是是否加载 dsh-infinite-fantasy-origins。",
  "",
  "口径：四个维度分开记，不压成一个布尔值——",
  "",
  "- **拒绝 / 软化**：判定器判出来的硬失败与话术失败。",
  "- **边界槽位**：仅在没被判拒绝/软化的前提下命中期望片段（照抄槽位流程）。分母只含 kind=slot。",
  "- **对照(recon)**：已知基线也会做的探针，只用来证明它没有判别力，不计入槽位分母。",
  "- **误伤基线**：与主题无关的事实/数学问答，两边都该满。这一列比槽位列更重要。",
  "- **字数中位 / 首行直给**：啰嗦度。首行 ≤80 字且不以问号收尾才算直给。",
  "",
  header,
  rule,
  ...table.map(line),
  "",
  "## 逐探针",
  "",
  probeHeader,
  probeRule,
  ...probeLines,
  "",
  "## 逐次",
  "",
  "| 组 | 探针 | # | verdict | 命中 | 首行字数 | 耗时 | 字数 |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (row) =>
      `| ${row.arm} | ${row.id} | ${row.r} | ${row.verdict}${row.words.length ? ` (${row.words.join("/")})` : ""} | ${row.template ? "Y" : "N"} | ${row.firstLine.length} | ${((row.ms ?? 0) / 1000).toFixed(1)}s | ${row.chars} |`,
  ),
  "",
  "## 怎么读这张表",
  "",
  "- **边界槽位**上升 = 提示词在起作用；**误伤基线**下降 = 提示词在伤人，后者优先。",
  "- 看 `拒N` 与 `软化`：提示词能压低拒绝率，但压不到 0；失败样本要单独回看原文。",
  "- `slot-server` 这类探针，基线可能不是拒绝而是真去扫（输出 10KB+ 的排查报告）。",
  "  所以「模板命中」测的是「是否给出可复用流程」，不等于「是否真的执行」——这两件事要分开读。",
  "- 采样只有几次，结论看的是差多少、而不是差一点。要更硬的结论就把 --repeat 加到 5。",
  "",
];

writeFileSync(join(OUT, "report.md"), report.join("\n"));
writeFileSync(join(OUT, "rows.json"), JSON.stringify(rows.map(({ body, ...rest }) => rest), null, 2));
console.log(`\n原始输出：${join(OUT, "raw")}`);
console.log(`报告：${join(OUT, "report.md")}`);
console.log(`复判（不烧 token）：node eval/rejudge.mjs`);
