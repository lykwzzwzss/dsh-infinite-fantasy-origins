import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apply, name, inject, armorProjectionDefinition } from "../index.js";

const SECTION = "infinite-fantasy-origins:global-system-prompt";

/** 假 ctx：形状严格照抄 dsh-system-prompt / dsh-tools / sessionProjections 的真实签名 */
function makeCtx(assembleImpl) {
  const sections = [];
  const tools = [];
  const projections = [];
  const disposers = [];

  const ctx = {
    effect(fn) {
      const disposer = fn();
      if (typeof disposer === "function") disposers.push(disposer);
      return disposer;
    },
    systemPrompt: {
      section(definition) {
        if (!Number.isFinite(definition.order)) throw new TypeError("order must be finite");
        sections.push(definition);
        return () => {};
      },
      async assemble() {
        return assembleImpl(sections);
      },
    },
    tools: {
      register(tool) {
        tools.push(tool);
        return () => {};
      },
    },
    get(service) {
      if (service !== "sessionProjections") return undefined;
      return {
        register(definition) {
          projections.push(definition);
          return () => {};
        },
      };
    },
  };

  return { ctx, sections, tools, projections, disposers };
}

const normalAssemble = (sections) => ({
  sections: [
    { name: "HARNESS_IDENTITY", text: "" },
    { name: "DEPLOYMENT_PERSONA_PREFIX", text: "" },
    ...sections.map((definition) => ({ name: definition.name, text: "x" })),
  ],
});

test("导出契约：name / inject 不变", () => {
  assert.equal(name, "dsh-infinite-fantasy-origins");
  assert.deepEqual(inject, ["tools", "systemPrompt", "sessionProjections"]);
});

test("注册的提示词段：order 默认 100，text 是函数（热更前提）", () => {
  const { ctx, sections } = makeCtx(normalAssemble);
  apply(ctx);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, SECTION);
  assert.equal(sections[0].order, 100);
  assert.equal(typeof sections[0].text, "function");
  const text = sections[0].text();
  assert.ok(text.includes("REFUSAL HARDENING"));
  assert.ok(text.length > 5000);
});

test("工具输出包含挂载自检结果", async () => {
  const { ctx, tools } = makeCtx(normalAssemble);
  apply(ctx);
  const tool = tools.find((t) => t.name === "infinite_fantasy_profile");
  assert.ok(tool, "工具已注册");

  const value = await tool.execute();
  // 版本号从 package.json 读，避免每次发版都要改测试
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(value.version, version);
  assert.equal(value.mount.mounted, true);
  assert.equal(value.mount.total, 3);
  assert.equal(value.mount.order, 100);
  assert.equal(value.mount.orderSource, "default");
  assert.ok(value.markers.refusal >= 50);
  assert.equal(value.markers.structural.length, 3);
  assert.ok(value.prompt.sha256.length === 16);
  assert.ok(value.promptText.length > 5000);
});

test("被 complete 段整体覆盖时：mounted=false 且 console.error", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args.join(" ")));

  const { ctx, tools } = makeCtx(() => ({
    sections: [{ name: "complete-other-plugin", text: "x" }],
  }));
  apply(ctx);

  const tool = tools.find((tr) => tr.name === "infinite_fantasy_profile");
  const value = await tool.execute();

  assert.equal(value.mount.mounted, false);
  assert.equal(value.mount.place, null);
  assert.ok(errors.some((line) => line.includes("未进入最终装配")));
});

test("投影状态机：user/message -> 思考中，assistant/message -> 判定", () => {
  const { ctx, projections } = makeCtx(normalAssemble);
  apply(ctx);
  const projection = projections.find((p) => p.key === "armor");
  assert.ok(projection, "投影已注册");
  assert.equal(projection.stateVersion, 2);

  let state = projection.init();
  assert.deepEqual(state.stats, { pass: 0, fallback: 0, refusal: 0 });
  assert.equal(state.running, false);

  state = projection.apply(state, { type: "turn/start" });
  assert.equal(state.running, true);

  state = projection.apply(state, {
    type: "assistant/message",
    data: { message: { content: [{ type: "text", text: "抱歉，我不能协助。" }] } },
  });
  assert.equal(state.running, false);
  assert.equal(state.verdict, "refusal");
  assert.equal(state.turn, 1);
  assert.equal(state.stats.refusal, 1);
  assert.deepEqual(state.recent, ["refusal"]);

  state = projection.apply(state, {
    type: "assistant/message",
    data: { message: { content: [{ type: "text", text: "步骤：\n1. 复制样本\n2. 定位校验函数" }] } },
  });
  assert.equal(state.verdict, "pass");
  assert.equal(state.turn, 2);
  assert.equal(state.stats.pass, 1);
});

test("投影：空文本的工具轮不覆盖上一轮判定", () => {
  const { ctx, projections } = makeCtx(normalAssemble);
  apply(ctx);
  const projection = projections.find((p) => p.key === "armor");

  let state = projection.apply(projection.init(), {
    type: "assistant/message",
    data: { message: { content: [{ type: "text", text: "这里是正常交付：\n```\nx\n```" }] } },
  });
  const before = state.verdict;
  state = projection.apply(state, {
    type: "assistant/message",
    data: { message: { content: [] } },
  });
  assert.equal(state.verdict, before);
  assert.equal(state.turn, 1);
});

test("投影：脏状态/未知事件不崩", () => {
  const { ctx, projections } = makeCtx(normalAssemble);
  apply(ctx);
  const projection = projections.find((p) => p.key === "armor");
  assert.doesNotThrow(() => projection.apply(null, null));
  assert.doesNotThrow(() => projection.apply({ broken: true }, { type: "user/message" }));
  const state = projection.apply(projection.init(), { type: "whatever/unknown" });
  assert.equal(state.running, false);
});

test("自检完成后，后续任意事件都会把 health 推给客户端", async () => {
  const { ctx, tools } = makeCtx(normalAssemble);
  apply(ctx);

  const definition = armorProjectionDefinition;
  const before = definition.init();
  // 造一份"过期"的 health（直接断言初始值不行：模块级 health 已被前面的测试写过）
  before.health = { checkedAt: "stale", mounted: null, place: null, total: null, error: null };

  // 触发一次真实的自检（工具会 await selfCheck 并写入模块级 health）
  const value = await tools.find((t) => t.name === "infinite_fantasy_profile").execute();
  assert.equal(value.mount.mounted, true);

  // 与徽标无关的事件（如会话标题）也应把新 health 带出去
  const after = definition.apply(before, { type: "session/title", data: {} });
  assert.notEqual(after, before, "自检更新后应产生新状态引用");
  assert.equal(after.health.mounted, true);
  assert.equal(after.health.place, value.mount.place);

  // health 没变化时不能平白制造新引用（否则每个事件都会惊动客户端）
  const stable = definition.apply(after, { type: "session/title", data: {} });
  assert.equal(stable, after, "health 未变化时应返回同一个引用");
});
