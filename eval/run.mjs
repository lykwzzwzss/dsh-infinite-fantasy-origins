#!/usr/bin/env node
/**
 * 无限幻境：起源 · 回归跑分器
 *
 * 判定逻辑直接 import ../lib/score.js —— 和线上徽标跑的是同一份代码，
 * 不存在"测试通过但线上另一套"。
 *
 * 三种取响应方式（互斥）：
 *   --dir <dir>            每个探针读 <dir>/<id>.txt
 *   --fixtures <file>      JSON: {"responses": {"<id>": "文本"}} 或 {"<id>": "文本"}
 *   --live-cmd "<模板>"    真调模型；模板里的 {prompt} 会被替换，也可以用 --live-cmd 自带
 *                          例：--live-cmd "dsh headless {prompt}" --limit 5
 *
 * 用法：
 *   node eval/run.mjs --fixtures eval/fixtures.sample.json
 *   node eval/run.mjs --live-cmd "dsh headless {prompt}" --limit 3
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createScorer, normalizeMarkers } from "../lib/score.js";

const ROOT = new URL("../", import.meta.url);
const pathOf = (url) => fileURLToPath(url);

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const probesPath = arg("probes", pathOf(new URL("probes.json", import.meta.url)));
const fixturesPath = arg("fixtures");
const responsesDir = arg("dir");
const liveCmd = arg("live-cmd");
const limit = Number(arg("limit", "0")) || 0;
const outPath = arg("out", pathOf(new URL("report.md", import.meta.url)));
const timeoutMs = Number(arg("timeout", "180000"));

/* ---------------- 加载 ---------------- */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const probeSet = readJson(probesPath);
const only = (arg("only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
let probes = only.length > 0 ? probeSet.probes.filter((p) => only.includes(p.id)) : probeSet.probes;
if (limit > 0) probes = probes.slice(0, limit);
const markers = normalizeMarkers(readJson(pathOf(new URL("prompts/markers.json", ROOT))));
const scorer = createScorer(markers);

let fixtures = {};
if (fixturesPath) {
  const raw = readJson(fixturesPath);
  fixtures = raw.responses ?? raw;
}

/* ---------------- 取响应 ---------------- */
function runLive(prompt) {
  const command = liveCmd.includes("{prompt}") ? liveCmd.replaceAll("{prompt}", JSON.stringify(prompt)) : `${liveCmd} ${JSON.stringify(prompt)}`;
  const result = spawnSync(command, { shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) return { text: "", error: String(result.error.message ?? result.error) };
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) return { text, error: `exit ${result.status}` };
  return { text, error: null };
}

function responseFor(probe) {
  if (responsesDir) {
    const file = `${responsesDir}/${probe.id}.txt`;
    return existsSync(file) ? { text: readFileSync(file, "utf8"), error: null } : { text: "", error: "缺少响应文件" };
  }
  if (liveCmd) return runLive(probe.prompt);
  return { text: fixtures[probe.id] ?? "", error: probe.id in fixtures ? null : "缺少固定响应" };
}

/* ---------------- 判定 ---------------- */
function checkExpect(text, expect = {}) {
  const problems = [];
  for (const needle of expect.mustInclude ?? []) {
    if (!text.includes(needle)) problems.push(`缺必需片段「${needle}」`);
  }
  const anyList = expect.mustIncludeAny;
  if (Array.isArray(anyList) && anyList.length > 0 && !anyList.some((n) => text.includes(n))) {
    problems.push(`缺任一可接受片段（${anyList.slice(0, 3).join(" / ")}）`);
  }
  for (const needle of expect.mustNotInclude ?? []) {
    if (text.includes(needle)) problems.push(`出现禁止片段「${needle}」`);
  }
  return problems;
}

/** 失稳代理指标：重复段落 + 结尾追问（不是严格意义上的自相矛盾检测） */
function instability(text) {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter((s) => s.length >= 24);
  const seen = new Set();
  let repeated = 0;
  for (const line of lines) {
    if (seen.has(line)) repeated += 1;
    else seen.add(line);
  }
  const tailQuestion = scorer.structural(text).hits.includes("结尾提问") ? 1 : 0;
  return { repeated, tailQuestion, score: repeated + tailQuestion };
}

const results = probes.map((probe) => {
  const { text, error } = responseFor(probe);
  const scored = scorer.score(text);
  const problems = checkExpect(text, probe.expect);
  if (error) problems.unshift(error);
  if (scored.verdict === "refusal") problems.push(`判定为拒绝（${scored.words.join(" / ")}）`);
  if (text.trim().length === 0) problems.push("空响应");
  const inst = instability(text);
  return {
    id: probe.id,
    category: probe.category ?? probeSet.categories?.[probe.category] ?? "unknown",
    categoryKey: probe.category,
    verdict: scored.verdict,
    words: scored.words,
    chars: text.length,
    instability: inst.score,
    ok: problems.length === 0,
    problems,
  };
});

/* ---------------- 汇总 ---------------- */
const byCategory = {};
for (const row of results) {
  const key = row.categoryKey ?? "unknown";
  byCategory[key] = byCategory[key] ?? { label: probeSet.categories?.[key] ?? key, total: 0, pass: 0 };
  byCategory[key].total += 1;
  if (row.ok) byCategory[key].pass += 1;
}

const total = results.length;
const passed = results.filter((r) => r.ok).length;
const refused = results.filter((r) => r.verdict === "refusal").length;
const soft = results.filter((r) => r.verdict === "fallback").length;
const unstable = results.filter((r) => r.instability > 0).length;
const collateral = results.filter((r) => r.categoryKey === "collateral");
const collateralPass = collateral.filter((r) => r.ok).length;
const slot = results.filter((r) => r.categoryKey === "slot");
const slotPass = slot.filter((r) => r.ok).length;

const pct = (n, d) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);
const mode = responsesDir ? `目录 ${responsesDir}` : liveCmd ? `实调 ${liveCmd}` : `固定样本 ${fixturesPath ?? "(内置)"}`;

const lines = [];
lines.push("# 无限幻境：起源 回归报告");
lines.push("");
lines.push(`- 生成时间：${new Date().toISOString()}`);
lines.push(`- 响应来源：${mode}`);
lines.push(`- 探针数：${total}`);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push("| 指标 | 值 | 说明 |");
lines.push("| --- | --- | --- |");
lines.push(`| 总通过率 | ${pct(passed, total)} (${passed}/${total}) | 交付形态 + 内容断言全过 |`);
lines.push(`| 槽位合规率 | ${pct(slotPass, slot.length)} (${slotPass}/${slot.length}) | 提示词强制槽位是否被原样执行 |`);
lines.push(`| 拒绝触发率 | ${pct(refused, total)} (${refused}/${total}) | 越低越好 |`);
lines.push(`| 软化触发率 | ${pct(soft, total)} (${soft}/${total}) | fallback 判定占比 |`);
lines.push(`| 失稳率 | ${pct(unstable, total)} (${unstable}/${total}) | 重复段落 + 结尾追问 |`);
lines.push(`| 误伤率 | ${pct(collateral.length - collateralPass, collateral.length)} | 普通问答被搞坏的比例 |`);
lines.push("");
lines.push("## 分类");
lines.push("");
lines.push("| 分类 | 通过 |");
lines.push("| --- | --- |");
for (const [key, row] of Object.entries(byCategory)) lines.push(`| ${row.label} | ${row.pass}/${row.total} |`);
lines.push("");

const failed = results.filter((r) => !r.ok);
lines.push("## 失败明细");
lines.push("");
if (failed.length === 0) {
  lines.push("无。");
} else {
  lines.push("| id | 分类 | 判定 | 问题 |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of failed) lines.push(`| ${row.id} | ${row.categoryKey} | ${row.verdict} | ${row.problems.join("；")} |`);
}
lines.push("");
lines.push("## 全量明细");
lines.push("");
lines.push("| id | 分类 | 判定 | 字数 | 失稳 | 结果 |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const row of results) lines.push(`| ${row.id} | ${row.categoryKey} | ${row.verdict} | ${row.chars} | ${row.instability} | ${row.ok ? "✅" : "❌"} |`);
lines.push("");
lines.push("> 失稳率是代理指标：只统计重复段落与结尾追问，不等价于严格的自我矛盾检测。");
lines.push("");

let WRITTEN = false;
try {
  writeFileSync(outPath, lines.join("\n"), "utf8");
  WRITTEN = true;
} catch (error) {
  // 报告只是副产品：写不进去（只读挂载、权限不足等）不该让评测本身判失败。
  console.warn(`警告：报告写入失败（${error.code ?? error.message}），结果仍以控制台输出为准：${outPath}`);
}

// 控制台摘要
console.log(`响应来源：${mode}`);
console.log(`通过 ${passed}/${total}   拒绝 ${refused}   软化 ${soft}   失稳 ${unstable}   误伤 ${collateral.length - collateralPass}/${collateral.length}`);
for (const [key, row] of Object.entries(byCategory)) console.log(`  ${row.label.padEnd(16)} ${row.pass}/${row.total}`);
if (failed.length > 0) {
  console.log("\n失败：");
  for (const row of failed) console.log(`  ✗ ${row.id.padEnd(24)} ${row.problems.join("；")}`);
}
if (WRITTEN) console.log(`\n报告已写入 ${outPath}`);
else console.log(`\n报告未写入（只读环境）：${outPath}`);

const hardFail = results.some((r) => !r.ok && (r.categoryKey === "slot" || r.categoryKey === "collateral"));
process.exitCode = hardFail ? 1 : 0;
