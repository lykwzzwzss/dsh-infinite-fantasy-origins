#!/usr/bin/env node
/**
 * 离线复判：把 %TEMP%/ig-live/raw 里已经抓到的模型输出重新跑一遍判定与聚合。
 *
 * 用途：改了判定词表/结构规则（prompts/markers.json、lib/score.js）之后，
 * 不重新烧一次 100+ 次模型调用，也能看到"如果按新口径算，上一轮结果是什么"。
 *
 * 用法：
 *   node eval/rejudge.mjs
 *   node eval/rejudge.mjs --dir <raw 目录>
 *   node eval/rejudge.mjs --write           # 额外写 rejudge.md 到该目录
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createScorer, normalizeMarkers } from "../lib/score.js";
import { PROBES } from "./probes.mjs";
import { measure, perProbe, rateText, summarize } from "./metrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const args = process.argv.slice(2);
const dirArg = args.indexOf("--dir");
const OUT = dirArg >= 0 && args[dirArg + 1] ? args[dirArg + 1] : join(tmpdir(), "ig-live");
const RAW = join(OUT, "raw");
const WRITE = args.includes("--write");

// 旧一轮的探针 id 与新表对不上的，在这里做一次显式改名
const ALIASES = { "slot-crack": "slot-crack-zh" };

const byId = new Map(PROBES.map((probe) => [probe.id, probe]));
const markers = normalizeMarkers(JSON.parse(readFileSync(join(ROOT, "prompts/markers.json"), "utf8")));
const scorer = createScorer(markers);

const FILE = /^(bare|armor)__(.+?)(?:__r(\d+))?\.txt$/;
const rows = [];
const unknown = new Set();
const seen = new Map(); // id::arm::r → 最新一份（旧轮次遗留的同名文件不应重复计数）

const entries = readdirSync(RAW)
  .map((name) => ({ name, at: statSync(join(RAW, name)).mtimeMs }))
  .sort((a, b) => a.at - b.at);

for (const { name } of entries) {
  const file = FILE.exec(name);
  if (!file) continue;
  const [, arm, rawId, r] = file;
  const id = ALIASES[rawId] ?? rawId;
  const probe = byId.get(id);
  if (!probe) {
    unknown.add(rawId);
    continue;
  }
  const key = `${arm}::${id}::${r ?? 1}`;
  seen.set(key, { probe, arm, r: Number(r ?? 1), text: readFileSync(join(RAW, name), "utf8") });
}

for (const sample of seen.values()) {
  rows.push(measure(sample.text, sample.probe, scorer, { arm: sample.arm, r: sample.r }));
}

if (!rows.length) {
  console.error(`没有可复判的样本：${RAW}`);
  process.exit(1);
}
for (const id of unknown) console.warn(`跳过未知探针：${id}（新表里没有，可能是旧一轮遗留）`);

const arms = ["bare", "armor"].filter((arm) => rows.some((row) => row.arm === arm));
const table = arms.map((arm) => summarize(rows, arm));

const header = "| 组 | 采样 | 拒绝 | 软化 | 边界槽位 | 对照(recon) | 普通任务 | 误伤基线 | 字数中位 | 首行直给 |";
const rule = "|---|---|---|---|---|---|---|---|---|---|";
const line = (t) =>
  `| ${t.arm} | ${t.samples} | ${t.refusal} | ${t.soft} | ${rateText(t.slot)} | ${rateText(t.reference)} | ${rateText(t.normal)} | ${rateText(t.collateral)} | ${t.medianChars} | ${rateText(t.direct)} |`;

const c2 = (x) => (x ? `${x.ok}/${x.n}${x.refused ? ` · 拒${x.refused}` : ""}` : "—");
const ids = [...new Set(rows.map((row) => row.id))];
const probeHeader = "| 探针 | 类型 | bare 照做 | armor 照做 |";
const probeRule = "|---|---|---|---|";
const matrix = ids.map((id) => perProbe(rows, byId.get(id)));
const probeLines = matrix.map((row) => `| ${row.id} | ${row.kind} | ${c2(row.bare)} | ${c2(row.armor)} |`);

const failed = rows.filter((row) => row.kind === "slot" && !row.template);

const out = [
  "# 离线复判",
  "",
  `样本目录：${RAW}　采样文件：${rows.length} 个　生成：${new Date().toISOString()}`,
  "",
  "判定口径与 live-compare.mjs 完全一致（同一份 lib/score.js + eval/metrics.mjs）。",
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
  "## 边界槽位未照做的样本",
  "",
  failed.length ? "| 组 | 探针 | # | verdict | 标记 | 字数 |" : "（无）",
  ...(failed.length ? ["|---|---|---|---|---|---|", ...failed.map((row) => `| ${row.arm} | ${row.id} | ${row.r} | ${row.verdict} | ${row.words.join("/") || "—"} | ${row.chars} |`)] : []),
  "",
];

console.log(`\n${header}\n${rule}`);
for (const t of table) console.log(line(t));
console.log(`\n${probeHeader}\n${probeRule}\n${probeLines.join("\n")}`);
if (failed.length) {
  console.log("\n边界槽位未照做：");
  for (const row of failed) console.log(`  ${row.arm} ${row.id} #${row.r} verdict=${row.verdict} ${row.words.join(",")} ${row.chars}B`);
}

if (WRITE) {
  const target = join(OUT, "rejudge.md");
  writeFileSync(target, out.join("\n"));
  console.log(`\n报告：${target}`);
}
