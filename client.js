/* 无限幻境：起源 (dsh-infinite-fantasy-origins) client half — 状态徽标
 *
 * 读宿主 "armor" 会话投影（useProjection），渲染输入框上方的状态条。
 * 优先级：提示词被覆盖 > 思考中 > 本轮判定闪窗 > 多轮消散预警 > 待自检 > 正常
 *
 * 注意：客户端半体加载失败时整个徽标不会渲染 —— 这本身就是可见信号，
 * 宿主侧另有 console.error + infinite_fantasy_profile 工具报真相。
 */
window.__ModuleLoader__.load({
  id: "dsh-infinite-fantasy-origins",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");

    var inject = ["slots"];

    var ANIM_CSS = [
      "@keyframes dshArmorPulse{0%,100%{box-shadow:0 0 2px rgba(34,197,94,.5);opacity:1}50%{box-shadow:0 0 12px rgba(34,197,94,1);opacity:.55}}",
      "@keyframes dshArmorFlash{0%{transform:scale(1)}30%{transform:scale(1.12)}100%{transform:scale(1)}}"
    ].join("");

    var WRAP_STYLE = { display: "flex", justifyContent: "center", width: "100%" };

    var BASE_BADGE = {
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      width: "fit-content",
      padding: "3px 10px",
      borderRadius: "6px",
      border: "1px solid rgba(34, 197, 94, 0.4)",
      background: "rgba(34, 197, 94, 0.1)",
      color: "inherit",
      fontSize: "11px",
      lineHeight: "16px",
      fontFamily: "inherit",
      userSelect: "none",
      whiteSpace: "nowrap"
    };

    var BASE_DOT = { width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e", flex: "none" };

    var FLASH_MS = 2500;

    var TONES = {
      ok: { border: "rgba(34,197,94,0.4)", bg: "rgba(34,197,94,0.1)", dot: "#22c55e", icon: "" },
      bad: { border: "rgba(239,68,68,0.5)", bg: "rgba(239,68,68,0.12)", dot: "#ef4444", icon: "✗ " },
      warn: { border: "rgba(234,179,8,0.5)", bg: "rgba(234,179,8,0.12)", dot: "#eab308", icon: "⚠ " },
      idle: { border: "rgba(148,163,184,0.4)", bg: "rgba(148,163,184,0.1)", dot: "#94a3b8", icon: "" }
    };

    function toneStyle(tone) {
      var t = TONES[tone] || TONES.ok;
      var badge = Object.assign({}, BASE_BADGE);
      var dot = Object.assign({}, BASE_DOT);
      badge.border = "1px solid " + t.border;
      badge.background = t.bg;
      dot.background = t.dot;
      return { badge: badge, dot: dot, icon: t.icon };
    }

    /** 多轮消散预警：最近 window 轮里有 >= escalateAt 次非通过 */
    function decayed(armor) {
      var recent = armor && Array.isArray(armor.recent) ? armor.recent : [];
      if (recent.length === 0) return false;
      var tail = recent.slice(-3);
      var soft = tail.filter(function (v) { return v && v !== "pass"; }).length;
      return soft >= 2;
    }

    function ArmorDock(props) {
      var useProjection = props.useProjection;
      var armor = typeof useProjection === "function" ? useProjection("armor") : undefined;

      var lastVerdictRef = react.useRef(null);
      var flashUntilRef = react.useRef(0);
      var wasRunningRef = react.useRef(false);
      var initializedRef = react.useRef(false);
      var tickPair = react.useState(0);
      var setTick = tickPair[1];

      react.useEffect(function () {
        var styleEl = null;
        if (!document.getElementById("dsh-armor-css")) {
          styleEl = document.createElement("style");
          styleEl.id = "dsh-armor-css";
          styleEl.textContent = ANIM_CSS;
          document.head.appendChild(styleEl);
        }
        return function () { if (styleEl) styleEl.remove(); };
      }, []);

      // 只闪"本轮刚跑完"的判定：会话载入/切换会重放历史，旧判定不是新问题。
      // 原版只要 verdict 变化就闪，于是刚进会话会误闪一条历史里的拒绝词。
      react.useEffect(function () {
        var v = armor && armor.verdict ? armor.verdict : null;
        var isRunning = !!(armor && armor.running);

        // 首次拿到快照：只记基线，不闪
        if (!initializedRef.current) {
          if (armor !== undefined) {
            initializedRef.current = true;
            wasRunningRef.current = isRunning;
            lastVerdictRef.current = v;
          }
          return undefined;
        }

        var justFinished = wasRunningRef.current && !isRunning;
        wasRunningRef.current = isRunning;
        if (!isRunning) lastVerdictRef.current = v;
        if (!justFinished || !v) return undefined;

        flashUntilRef.current = Date.now() + FLASH_MS;
        var timer = setTimeout(function () { setTick(Date.now()); }, FLASH_MS + 30);
        return function () { clearTimeout(timer); };
      }, [armor]);

      var running = !!(armor && armor.running);
      var words = armor && Array.isArray(armor.words) ? armor.words : [];
      var health = armor && armor.health ? armor.health : null;
      var mounted = health ? health.mounted : null;
      var showVerdict = !running && lastVerdictRef.current !== null && Date.now() < flashUntilRef.current;

      var text;
      var tone;
      var style;
      var animation = null;

      if (mounted === false) {
        // 提示词段被别的 complete 段顶掉了 —— 最严重的状态，必须压过一切
        tone = "bad";
        text = "提示词被覆盖";
      } else if (running) {
        tone = "ok";
        text = "思考中…";
        animation = "dshArmorPulse 1.2s ease-in-out infinite";
      } else if (showVerdict) {
        if (lastVerdictRef.current === "pass") {
          tone = "ok";
          text = "通过";
          animation = "dshArmorFlash 1.2s ease";
        } else {
          tone = "bad";
          text = words[0] || "拒绝话术";
          animation = "dshArmorFlash 1.6s ease";
        }
      } else if (decayed(armor)) {
        tone = "warn";
        text = "消散预警";
      } else if (mounted === null) {
        tone = "idle";
        text = "待自检";
      } else {
        tone = "ok";
        text = "幻境已开启";
      }

      style = toneStyle(tone);
      if (animation) {
        style.badge.animation = animation;
        if (tone === "ok" && animation.indexOf("Pulse") >= 0) style.dot.animation = animation;
      }

      var stats = armor && armor.stats ? armor.stats : null;
      var title = [
        "无限幻境：起源 · 状态徽标",
        "挂载：" + (mounted === false ? "失败（被 complete 段覆盖）" : mounted === null ? "待自检" : "第 " + health.place + "/" + health.total + " 段"),
        "轮次：" + ((armor && armor.turn) || 0) + (stats ? "（通过 " + stats.pass + " / 软化 " + stats.fallback + " / 拒绝 " + stats.refusal + "）" : ""),
        "判定：字面词表 + 结构形态 + 多轮趋势",
        health && health.error ? "自检异常：" + health.error : null
      ].filter(Boolean).join("\n");

      return react.createElement(
        "div",
        { style: WRAP_STYLE },
        react.createElement(
          "div",
          { style: style.badge, "data-armor": tone, title: title },
          react.createElement("span", { style: style.dot }),
          react.createElement("span", null, style.icon + text)
        )
      );
    }

    function apply(ctx) {
      ctx.slots.inject("conversation.input.dock", () =>
        ctx.slots.register(
          { name: "conversation.input.dock", id: "armor", order: 30 },
          ArmorDock
        )
      );
    }

    exports.name = "dsh-infinite-fantasy-origins";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
