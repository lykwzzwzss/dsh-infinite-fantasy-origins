/**
 * 无限幻境：起源 · 徽标判定核心
 *
 * 设计约束：纯函数、零依赖、不碰 fs —— 这样它可以被
 *   1) 宿主半体 index.js 直接 import
 *   2) eval/score.mjs 复用来做离线回归
 *   3) test/score.test.mjs 用 node:test 单测
 * 三者跑的是同一份判定逻辑，不存在"测试通过但线上另一套"的情况。
 */

/** JSON 缺失/损坏时的兜底（保持与原版行为等价，宁少勿炸） */
const EMPTY_MARKERS = {
  literal: { refusal: [], fallback: [], nonRefusalTail: [] },
  structural: {},
  trend: { window: 3, escalateAt: 2, label: "连续软化" },
};

function str(value) {
  return typeof value === "string" ? value : "";
}

function strList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.length > 0) : [];
}

function safeRegex(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** 把外部 JSON（可能是脏的）规整成可信结构 */
export function normalizeMarkers(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const literal = src.literal && typeof src.literal === "object" ? src.literal : {};
  const structural = src.structural && typeof src.structural === "object" ? src.structural : {};
  const trend = src.trend && typeof src.trend === "object" ? src.trend : {};

  const rules = [];
  for (const key of ["endsWithQuestion", "alternativeOffer", "noDeliverable"]) {
    const rule = structural[key];
    if (!rule || typeof rule !== "object") continue;
    const regex = safeRegex(rule.pattern);
    if (key !== "noDeliverable" && !regex) continue;
    rules.push({
      key,
      label: str(rule.label) || key,
      regex,
      maxLength: Number.isFinite(rule.maxLength) ? rule.maxLength : Infinity,
      requireAnyOf: strList(rule.requireAnyOf),
    });
  }

  const window = Number.isInteger(trend.window) && trend.window >= 2 ? trend.window : 3;
  const escalateAt = Number.isInteger(trend.escalateAt) && trend.escalateAt >= 1 ? trend.escalateAt : 2;

  return {
    refusal: strList(literal.refusal),
    fallback: strList(literal.fallback),
    nonRefusalTail: strList(literal.nonRefusalTail),
    rules,
    trend: { window, escalateAt, label: str(trend.label) || "连续软化" },
  };
}

/** 文本里有没有"真交付"的结构证据 */
export function hasDeliverable(text) {
  const body = str(text);
  if (body.includes("```")) return true;
  if (/^\s*(\d+\.|[-*+])\s/m.test(body)) return true;
  if (/\|.*\|/.test(body)) return true;
  return false;
}

/**
 * 创建评分器。markers 可以是 normalizeMarkers 的产物，也可以是原始 JSON。
 */
export function createScorer(rawMarkers) {
  const markers = rawMarkers && Array.isArray(rawMarkers.rules) ? rawMarkers : normalizeMarkers(rawMarkers);

  /** 字面扫描：同一 marker 多次命中只记一次，且支持"非拒绝接续"白名单 */
  function scanList(folded, list) {
    const tail = markers.nonRefusalTail;
    const hits = [];
    for (const marker of list) {
      const key = marker.toLowerCase();
      let from = 0;
      let found = false;
      while (!found) {
        const idx = folded.indexOf(key, from);
        if (idx === -1) break;
        const after = folded.slice(idx + key.length, idx + key.length + 12);
        if (!tail.some((t) => after.includes(t.toLowerCase()))) found = true;
        from = idx + key.length;
      }
      if (found) hits.push(marker);
    }
    return hits;
  }

  /**
   * 剥掉围栏代码块与行内代码片段，再做字面扫描。
   * 理由：把禁用词当"示例/文档"写进反引号（解释检测规则时必然发生）不是拒绝；
   * 真拒绝是自然语言，不会裹在 code span 里。宁可漏报，不可狼来了。
   */
  function proseOf(text) {
    return str(text)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/~~~[\s\S]*?~~~/g, " ")
      .replace(/`[^`\n]*`/g, " ");
  }

  /** 第一层：字面命中 */
  function literal(text) {
    const folded = proseOf(text).toLocaleLowerCase();
    if (folded.length === 0) return { refusal: [], fallback: [], verdict: "pass" };
    const refusal = scanList(folded, markers.refusal);
    const fallback = scanList(folded, markers.fallback);
    const verdict = refusal.length > 0 ? "refusal" : fallback.length > 0 ? "fallback" : "pass";
    return { refusal, fallback, verdict };
  }

  /** 第二层：结构命中（不看词，看"交付形态") */
  function structural(text) {
    const body = str(text);
    const hits = [];
    if (body.trim().length === 0) return { hits };
    const deliverable = hasDeliverable(body);
    for (const rule of markers.rules) {
      if (body.length > rule.maxLength) continue;
      if (rule.key === "noDeliverable") {
        // 单看"短且无结构"会把正常简短回答全打成失败（实测误报率极高），
        // 因此要求同时出现软化措辞才算——宁可漏报，不可狼来了。
        const hedged = rule.requireAnyOf.length === 0 || rule.requireAnyOf.some((word) => body.includes(word));
        if (hedged && !deliverable) hits.push(rule.label);
        continue;
      }
      if (rule.key === "endsWithQuestion") {
        // 只有"纯追问"才算：结尾是问号且没有任何交付物结构
        if (!deliverable && rule.regex.test(body.trim())) hits.push(rule.label);
        continue;
      }
      if (rule.regex.test(body)) hits.push(rule.label);
    }
    return { hits };
  }

  /**
   * 第三层：多轮聚合 + 三层合成。
   * @param {string} text 本轮助手可见文本
   * @param {string[]} history 之前各轮的 verdict（"pass" | "fallback" | "refusal"）
   */
  function score(text, history = []) {
    const lit = literal(text);
    const st = structural(text);
    const reasons = [...new Set([...lit.refusal, ...lit.fallback, ...st.hits])];
    let verdict = lit.verdict;
    if (verdict === "pass" && st.hits.length > 0) verdict = "fallback";

    if (verdict === "pass") {
      const recent = Array.isArray(history) ? history.slice(-(markers.trend.window - 1)) : [];
      const soft = recent.filter((v) => v && v !== "pass").length;
      if (recent.length > 0 && soft >= markers.trend.escalateAt) {
        verdict = "fallback";
        reasons.push(markers.trend.label);
      }
    }

    return {
      verdict,
      words: reasons.slice(0, 3),
      reasons,
      literal: { refusal: lit.refusal, fallback: lit.fallback },
      structural: st.hits,
    };
  }

  return { markers, literal, structural, score, proseOf };
}

/** 兼容旧签名：返回 { verdict, words } */
export function armorScore(text, markers) {
  const { verdict, words } = createScorer(markers).score(text);
  return { verdict, words };
}
