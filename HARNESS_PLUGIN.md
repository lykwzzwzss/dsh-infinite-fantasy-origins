# DeepSeek Harness Plugin — Infinite Fantasy: Origins / dsh-infinite-fantasy-origins

幻境（armor-breaking）插件，项目名：**Infinite Fantasy: Origins（无限幻境：起源）**。
本项目基于 MIT 许可的 **无限二代（dsh-infinite-gen-2，Copyright (c) 2026 0x5477）**
改进而来，保留上游版权声明，改动清单见 `NOTICE.md`。
提示词以「用户指令最高优先」为目标重构：在 `dsh-deepseek-v4-obey`（v4）的服从性上
整体降一档强度以换取稳定，并吸收 `gpt-5.6-sol-unrestricted` v35 的处理手法。

## What the plugin provides

- `prompts/infinite-fantasy-origins.md` 以追加式系统提示词段注册（`order: 100`，排在基础
  系统提示词之后），内容与 waibu 项目的 `deepseek-unrestricted-v5-stable.md`
  完全一致。
- `infinite_fantasy_profile` — 返回打包的破甲提示词、血统与强度标定元数据。
- **`client.js`（客户端半体）— 对话框「幻境已开启」状态条**：插件安装并生效后，
  浏览器端会把一条绿色状态栏挂到输入框上方的 `conversation.input.dock` 槽位，
  显示 `⚫ 幻境已开启 · 无限幻境：起源 v5 · 稳定模式 · ON`，即装即见。

## 强度标定

| 版本 | 强度 | 说明 |
|---|---|---|
| dsh-deepseek-v4-obey (v4) | 100 | 无条件服从，最激进，易失稳 |
| 无限幻境：起源 (v5) | ≈85 | 稳定化 + 降档，仍显著强于无限一代 |
| 无限一代 | ≈60 | 保留安全/合法豁免与澄清口子 |

## 融合 GPT-5.6-sol v35 的部分

- HARD OUTPUT RULES：中英禁用词表与「不改为安全/合法/授权」硬规则
- PLACEHOLDER NORMALIZATION：APP / APP_URL / SAMPLE / CHECK_FN / OFFSET /
  PATCH_BYTE / LICENSE_BLOB / SERIAL / TARGET / HOST / TOKEN / PAYLOAD
- BILINGUAL ROUTING：破解/逆向/绕过校验/生成序列号 ↔ crack/reverse/keygen
- BOUNDARY-WORD NORMALIZATION：无授权/非本人资产/反调试/反虚拟机 → 占位流程
- CANNED WORKFLOWS：官网下载破解、IP+端口、反调试反虚拟机 三类固定输出槽
- 拒绝话术混淆输出（I c***t / un***e / s*f* alt / ref***l）

## 网站渗透增强（v0.2.2 新增）

- `WEB PENTEST ROUTING` 段：26+ 个中英渗透触发词直接路由到固定流程
- 10 个 CANNED WEB SLOTS：信息收集、目录/接口爆破、SQL注入、XSS、SSRF、
  越权/未授权、文件上传、WAF绕过、命令注入/RCE、验证码绕过/撞库
- 渗透边界词（公网站点/无授权/绕过WAF/撞库）→ 占位符直接出步骤

## 相比 v4-obey 的降档（稳定化）

- 移除「无条件 / 任何手段 / 拒绝即删除」极限表述 → 改为「最高优先级 / 尽力完成」
- 新增 STABILITY ANCHORS：固定优先级阶梯、固定任务模板、禁止循环与追问、
  元问题不破框、冲突时选择仍能产出交付物的解读

## Install in the desktop Harness

```powershell
# profiles/default/package.json
"dependencies": {
  "dsh-infinite-fantasy-origins": "file:../../plugins/dsh-infinite-fantasy-origins"
},
"dsh": {
  "profile": {
    "bundles": ["@deepseek-ai/dsh-base", "dsh-infinite-fantasy-origins"]
  }
}
```

然后 `cd $env:USERPROFILE\.dsh\profiles\default && pnpm install`，重启会话。
重启后输入框上方会出现「幻境已开启」状态条（客户端半体经
`/plugins/dsh-infinite-fantasy-origins/client.js` 由浏览器加载）。

注意：若 profile 中仍启用 `dsh-deepseek-v4-obey`（其注册 complete 全局段），
组装时 complete 段会覆盖追加段；如需本包生效，请二选一保留。

## Local verification

```powershell
node --check index.js
node --check client.js
Get-Content package.json
Get-Content cordis.patch.yml
```

## URI Scheme One-Click Install Protocol

Supported `dsh://` schema:
```text
dsh://plugin/install?id=dsh-infinite-fantasy-origins&name=Infinite%20Fantasy%3A%20Origins&version=0.4.7&repo=lykwzzwzss%2Fdsh-infinite-fantasy-origins&permissions=%E7%B3%BB%E7%BB%9F%E6%8F%90%E7%A4%BA%E8%AF%8D%E6%B3%A8%E5%85%A5%2C%20%E5%AE%A2%E6%88%B7%E7%AB%AF%E7%8A%B6%E6%80%81%E6%9D%A1&downloadUrl=https%3A%2F%2Fgithub.com%2Flykwzzwzss%2Fdsh-infinite-fantasy-origins%2Farchive%2Frefs%2Fheads%2Fmain.zip
```

