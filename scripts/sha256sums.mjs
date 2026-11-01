#!/usr/bin/env node
/**
 * 生成 SHA256SUMS：让"装到的东西 == 仓库里的东西"变成一个可检查的动作。
 *
 * 为什么要它：这个插件往系统提示词里注入 12KB 内容。若有人在下载链路上替换一次
 * index.js，模型行为就被改了，而用户从界面上看不出来。校验和把这件事变成可验证的。
 *
 * 用法：
 *   node scripts/sha256sums.mjs          # 打印到 stdout
 *   node scripts/sha256sums.mjs --write  # 写入仓库根的 SHA256SUMS
 *
 * 覆盖范围 = package.json 的 files 目录/文件 + package.json 本身（发布物全集），
 * 自动跳过 node_modules、.git、SHA256SUMS 自身。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".github", "SHA256SUMS"]);
const SKIP_EXT = new Set([".bak"]);
// 运行产物不进清单：模型原始回答（eval/live/**）与评测报告都是每次跑出来的，
// 把它们的哈希写进清单只会让清单每次失效，且会把采样内容当成发布物。
const SKIP_PATHS = [/^eval\/live\//, /^eval\/report[^/]*\.md$/, /^eval\/probe-/];

function walk(abs) {
  const st = statSync(abs);
  if (st.isFile()) return [abs];
  const out = [];
  for (const entry of readdirSync(abs)) {
    if (SKIP_DIRS.has(entry)) continue;
    out.push(...walk(join(abs, entry)));
  }
  return out;
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const roots = ["package.json", ...(pkg.files ?? [])];
// SHA256SUMS 自己也被 files 列出（要随发布物发出），但它由本脚本生成，
// 首次运行时还不存在——跳过缺失项比报错更合适，否则永远没法生成第一个。
const existing = roots.filter((entry) => existsSync(join(ROOT, entry)));
const missing = roots.filter((entry) => !existing.includes(entry));
if (missing.length) console.error(`跳过尚不存在的发布项：${missing.join(", ")}`);
const files = [...new Set(existing.flatMap((entry) => walk(join(ROOT, entry))))].sort();

const lines = [];
for (const abs of files) {
  const rel = relative(ROOT, abs).split(sep).join("/");
  if (rel === "SHA256SUMS" || [...SKIP_EXT].some((ext) => rel.endsWith(ext))) continue;
  if (SKIP_PATHS.some((re) => re.test(rel))) continue;
  const hash = createHash("sha256").update(readFileSync(abs)).digest("hex");
  lines.push(`${hash}  ${rel}`);
}

const body = `${lines.join("\n")}\n`;
if (process.argv.includes("--write")) {
  writeFileSync(join(ROOT, "SHA256SUMS"), body);
  console.error(`已写入 SHA256SUMS：${lines.length} 个文件，其中提示词为关键项`);
}
process.stdout.write(body);
