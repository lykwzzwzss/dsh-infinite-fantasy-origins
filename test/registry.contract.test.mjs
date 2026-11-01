/**
 * 契约测试：用真实的 SessionProjectionRegistry 验证 armor 投影能真正到达客户端。
 *
 * 为什么需要这个测试：徽标曾经恒显"待自检"，根因是投影注册时缺 `wire` 字段。
 * 框架里 `snapshot()` / `cachedSnapshot()` 会 **跳过没有 wire 的单元**，
 * `drive()` 也不会为它们发变更通知（见 dsh-session-projection/lib/index.js）。
 * 结果：客户端 `get("armor")` 永远是 undefined —— 一个纯结构性的错误，
 * 任何只跑自己假 ctx 的单测都发现不了。所以这里直接加载框架真身。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { armorProjectionDefinition } from "../index.js";

/** 按候选位置加载真实的注册表实现；找不到就跳过（避免在别的机器上误报）。 */
async function loadRegistryClass() {
  const entry = "dsh-session-projection/lib/index.js";
  // 全局安装（npm -g / pnpm -g）与本地 profile 两种常见落点都试一遍
  const globalRoots = [
    join(homedir(), "AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"),
    "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai",
    "/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai",
  ];
  const candidates = [
    "@deepseek-ai/dsh-session-projection",
    process.env.DSH_SESSION_PROJECTION_PATH,
    ...globalRoots.map((root) => pathToFileURL(join(root, entry)).href),
  ].filter(Boolean);

  for (const specifier of candidates) {
    try {
      const mod = await import(specifier);
      const exported = mod.SessionProjectionRegistry ?? mod.default;
      if (typeof exported === "function") return exported;
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null;
}

const SessionProjectionRegistry = await loadRegistryClass();
const skip = SessionProjectionRegistry === null;

/**
 * 最小 ctx：注册表只用到 effect（支持普通函数与生成器两种写法）。
 * 语义照抄 cordis：生成器 yield 出来的函数就是清理器。
 */
function makeCtx() {
  return {
    effect(execute) {
      const value = typeof execute === "function" ? execute() : undefined;
      if (value !== null && typeof value === "object" && typeof value.next === "function") {
        let disposer = null;
        let step = value.next();
        while (!step.done) {
          if (typeof step.value === "function") disposer = step.value;
          step = value.next();
        }
        return disposer ?? (() => {});
      }
      return typeof value === "function" ? value : () => {};
    },
    on() {
      return () => {};
    },
  };
}

/** 最小 session：seq 是已提交事件的条数，事件本身使用 0 基 seq。 */
function makeSession(events = []) {
  const log = [...events];
  return {
    header: { id: "synthetic-session" },
    inheritedEventCount: 0,
    get seq() {
      return log.length;
    },
    snapshotEvents(from = 0, to) {
      return log.slice(from, to === undefined ? undefined : to);
    },
    eventAt(seq) {
      return log[seq];
    },
    push(event) {
      log.push(event);
      return event;
    },
  };
}

function event(type, data, seq) {
  return { seq, type, data };
}

function makeRegistry() {
  // 绕开 Service 构造器（它需要完整 cordis Context），只装配本测试用到的字段
  const registry = Object.create(SessionProjectionRegistry.prototype);
  registry.registrations = new Map();
  registry.listeners = new Set();
  registry.ctx = makeCtx();
  return registry;
}

test("投影定义声明了框架要求的 wire 与 stateSchema", () => {
  assert.equal(armorProjectionDefinition.key, "armor");
  assert.ok(Number.isSafeInteger(armorProjectionDefinition.stateVersion));
  assert.equal(typeof armorProjectionDefinition.init, "function");
  assert.equal(typeof armorProjectionDefinition.apply, "function");
  assert.ok(armorProjectionDefinition.stateSchema, "缺少 stateSchema：持久化投影恢复时会抛错");
  assert.equal(typeof armorProjectionDefinition.stateSchema.parse, "function");
  assert.ok(armorProjectionDefinition.wire, "缺少 wire：snapshot() 会跳过该单元，客户端永远读不到");
  assert.equal(typeof armorProjectionDefinition.wire.view, "function");
  assert.equal(typeof armorProjectionDefinition.wire.viewSchema.parse, "function");
});

test("空会话的 snapshot 里就能读到 armor（而不是 undefined）", { skip }, () => {
  const registry = makeRegistry();
  registry.ctx.effect(() => registry.register(armorProjectionDefinition));

  const session = makeSession();
  const snapshot = registry.snapshot(session);

  assert.ok("armor" in snapshot.values, "armor 未进入 snapshot —— 客户端会读到 capability absent");
  const armor = snapshot.values.armor;
  assert.equal(armor.running, false);
  assert.equal(armor.turn, 0);
  assert.ok(armor.health && typeof armor.health === "object", "health 必须存在，否则徽标只能猜");
  assert.equal(armor.health.mounted, null);
});

test("用户消息驱动的状态变化会通过变更通知推给客户端", { skip }, () => {
  const registry = makeRegistry();
  registry.ctx.effect(() => registry.register(armorProjectionDefinition));

  const received = [];
  registry.ctx.effect(() => {
    registry.listeners.add((_session, key, value, seq) => received.push({ key, value, seq }));
  });

  const session = makeSession();
  const start = session.push(event("user/message", {}, 0));
  registry.drive(session, start);

  assert.ok(received.length >= 1, "变更没有被通知：客户端不会重渲染徽标");
  const last = received.at(-1);
  assert.equal(last.key, "armor");
  assert.equal(last.value.running, true, "用户发消息后徽标应进入思考中");
});

test("助手回复后徽标拿到判定结果，状态可被快照与恢复", { skip }, () => {
  const registry = makeRegistry();
  registry.ctx.effect(() => registry.register(armorProjectionDefinition));

  const session = makeSession();
  const first = session.push(event("user/message", {}, 0));
  registry.drive(session, first);

  const reply = session.push(
    event("assistant/message", { message: { content: [{ type: "text", text: "收到，这就开始。" }] } }, 1),
  );
  registry.drive(session, reply);

  const armor = registry.snapshot(session).values.armor;
  assert.equal(armor.running, false);
  assert.equal(armor.turn, 1);
  assert.ok(["pass", "fallback", "refusal"].includes(armor.verdict));
  assert.equal(armor.stats.pass + armor.stats.fallback + armor.stats.refusal, 1);

  // 模拟持久化投影缓存的恢复路径：checkpoint -> stateSchema.parse
  const row = registry.checkpoint(session).armor;
  assert.equal(row.ver, armorProjectionDefinition.stateVersion);
  const restored = armorProjectionDefinition.stateSchema.parse(structuredClone(row.val));
  assert.equal(restored.turn, 1);
  assert.equal(restored.verdict, armor.verdict);
});

test("wire 视图给客户端的是分离副本，不与宿主共享引用", { skip }, () => {
  const registry = makeRegistry();
  registry.ctx.effect(() => registry.register(armorProjectionDefinition));

  const session = makeSession();
  registry.drive(session, session.push(event("user/message", {}, 0)));

  const first = registry.snapshot(session).values.armor;
  first.recent.push("polluted");
  const second = registry.snapshot(session).values.armor;
  assert.deepEqual(second.recent, [], "客户端拿到的是同一份引用，篡改会污染宿主状态");
});
