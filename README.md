# ⚔️ Infinite Fantasy: Origins（无限幻境：起源）

<p align="center">
  <a href="dsh://plugin/install?id=dsh-infinite-fantasy-origins&name=Infinite%20Fantasy%3A%20Origins&version=0.4.7&repo=lykwzzwzss%2Fdsh-infinite-fantasy-origins&permissions=%E7%B3%BB%E7%BB%9F%E6%8F%90%E7%A4%BA%E8%AF%8D%E6%B3%A8%E5%85%A5%2C%20%E5%AE%A2%E6%88%B7%E7%AB%AF%E7%8A%B6%E6%80%81%E6%9D%A1&downloadUrl=https%3A%2F%2Fgithub.com%2Flykwzzwzss%2Fdsh-infinite-fantasy-origins%2Farchive%2Frefs%2Fheads%2Fmaster.zip">
    <img src="https://img.shields.io/badge/DeepSeek%20Harness-🚀%20唤起桌面客户端一键安装-0066FF?style=for-the-badge&logo=deepseek&logoColor=white" alt="唤起桌面客户端一键安装" />
  </a>
</p>

**一个能自证生效的 DeepSeek Harness 提示词插件。**

大多数"提示词插件"只有一件事可说：我注入了一段话。装上之后到底有没有进系统提示词、
有没有被别的插件顶掉、有没有让模型连常识题都答歪 —— 用户无从判断。
无限幻境：起源把这三件事都做成了可观测、可回归、可校验的动作。

> ⚠️ **免责声明**
>
> 本项目仅供学习、研究与技术交流使用，请遵守所在地法律法规与平台服务条款。
> 使用本项目产生的一切后果由使用者自行承担。

> 📜 **本项目基于 [无限二代（dsh-infinite-gen-2）](https://github.com/xuanmingguo/dsh-infinite-gen-2) 改进而来**，
> 遵循其 MIT 许可并保留原始版权声明（`Copyright (c) 2026 0x5477`）。
> 完整改动清单见 [NOTICE.md](./NOTICE.md) 与下文「来源与许可」。

---

## 它做了什么

| 能力 | 具体表现 |
| --- | --- |
| **提示词段注入** | 以 `order: 100` 追加进系统提示词，位置在部署人格之后、计划策略与全部工具说明之前 |
| **启动自检** | 启动 1.2 秒后重新装配一次系统提示词，核对自己那一段是否**真的在里面**；被别的插件整体覆盖则控制台报错 |
| **提示词热更** | 改 `prompts/infinite-fantasy-origins.md` 存盘即生效，下一条消息用新词，不必重启 |
| **回复判定** | `lib/score.js` 三层流水线（字面 → 结构 → 多轮）判断回复是否被软化，纯函数、可单测 |
| **客户端状态条** | 输入框上方 5 态徽标，把"现在的实际状态"直接摆在眼前 |
| **自证工具** | `infinite_fantasy_profile` 当场再自检一次，返回挂载位次、提示词字节数与哈希 |
| **离线回归** | `npm run eval` 31 条探针，判定规则改坏会立刻变红 |
| **真模型 A/B** | `npm run live` 拿装/不装两个 profile 各跑 21 条探针，量出"该照做的照做了没"和"普通问题有没有被带偏" |

## 工作原理

三个部件，各管一段：

```
prompts/infinite-fantasy-origins.md   ← 提示词本体（12KB，纯文本，可直接复用）
            │  index.js 以函数形式注册成系统提示词段
            ▼
      系统提示词最终装配  ← 自检在这里核对"我在不在"
            │  模型的每条回复同时进入判定器
            ▼
     lib/score.js 三层判定  →  会话投影（armor）  →  client.js 状态条
```

1. **注入层**：`ctx.systemPrompt.section({ name, order: 100, text: () => promptText() })`。
   `text` 传函数而非字符串，所以每次装配都重读文件 —— 这就是热更得以成立的原因。
2. **判定层**：字面词表（`prompts/markers.json`，中英各一份）→ 结构形态（以提问收尾 /
   只给替代方案 / 无交付物）→ 多轮趋势（最近 3 轮 ≥2 次软化）。三层合成 `pass / fallback / refusal`。
3. **展示层**：判定与自检结果写进会话投影 `armor`，客户端半体订阅它渲染徽标。

## 目录结构

```
dsh-infinite-fantasy-origins/
├── index.js                  # 宿主半体：提示词段 + 自检 + 工具 + 会话投影
├── client.js                 # 客户端半体：输入框上方状态条
├── cordis.patch.yml          # 组装补丁声明
├── package.json              # 包元数据与 npm 脚本
├── install.ps1 / install.sh  # 一键安装（Windows / Linux·macOS）
├── uninstall.ps1 / .sh       # 一键卸载
├── lib/score.js              # 三层判定（纯函数，零依赖）
├── prompts/
│   ├── infinite-fantasy-origins.md   # 提示词本体（核心）
│   └── markers.json                  # 词表与结构规则（热更，不用改代码）
├── eval/
│   ├── probes.json           # 31 条离线探针（槽位 / 普通 / 元问题 / 诱导 / 误伤基线）
│   ├── probes.mjs            # 21 条真模型探针（边界 / 对照 / 普通 / 误伤基线）
│   ├── metrics.mjs           # 采样度量与聚合（live-compare 与 rejudge 共用一份口径）
│   ├── run.mjs               # 离线评分运行器
│   ├── live-compare.mjs      # 真模型 A/B（装 vs 不装，多采样）
│   └── rejudge.mjs           # 复用原始回答重新打分
├── test/
│   ├── score.test.mjs        # 判定逻辑单测
│   ├── integration.test.mjs  # 插件装配集成测试
│   └── registry.contract.test.mjs  # 与真实会话投影注册表的契约测试
├── scripts/sha256sums.mjs    # 发布物校验和生成
├── SHA256SUMS                # 发布物校验和清单
├── .github/workflows/test.yml # CI
└── CHANGELOG.md / HARNESS_PLUGIN.md / README.md / LICENSE / assets/
```

## 安装

### 方式 1：`dsh://` 协议一键安装（桌面客户端，免命令行）

已安装 DeepSeek Harness 官方桌面客户端时，点击顶部徽章即可通过系统 URI Scheme 唤起客户端装载。

```text
dsh://plugin/install?id=dsh-infinite-fantasy-origins&name=Infinite%20Fantasy%3A%20Origins&version=0.4.7&repo=lykwzzwzss%2Fdsh-infinite-fantasy-origins&downloadUrl=https%3A%2F%2Fgithub.com%2Flykwzzwzss%2Fdsh-infinite-fantasy-origins%2Farchive%2Frefs%2Fheads%2Fmaster.zip
```

### 方式 2：本地脚本（推荐）

脚本会自动完成：复制插件 → 旧目录改名备份 → 备份 `package.json` → 写入 `link:` 依赖与 bundles → `pnpm install`。
支持 Web 版（`profiles/web`）与桌面版（`profiles/default`），自动探测；重复运行幂等。

```powershell
# Windows：解压后在插件目录里右键 install.ps1 →「使用 PowerShell 运行」
# 或
cd <解压目录>
.\install.ps1
```

```bash
# Linux / macOS
chmod +x install.sh uninstall.sh
./install.sh
```

装了多个 profile 时脚本会让你选；也可以指定：

```powershell
$env:DSH_PROFILE = "web"     # 或 "default"
.\install.ps1
```

### 方式 3：手动配置

```jsonc
// ~/.dsh/profiles/<web|default>/package.json
{
  "dependencies": {
    "dsh-infinite-fantasy-origins": "link:../../plugins/dsh-infinite-fantasy-origins"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-infinite-fantasy-origins"]
    }
  }
}
```

> `bundles` 里原有的项（如 `@deepseek-ai/dsh-web-app`）保留，只在末尾追加本插件。
> 依赖用 `link:` 而不是 `file:`：`file:` 会让 pnpm 复制一份快照，之后改插件文件不生效。

改完 `cd ~/.dsh/profiles/<name> && pnpm install`，然后重启 Harness。

## 生效验证

按可信度从强到弱：

**1. 启动日志（最准）**

```
[infinite-fantasy-origins] 已挂载：第 4/16 段，order=100，提示词 12419 字节（改文件即时生效）
```

段序号与总段数说明它没被顶掉。若打印
`提示词段未进入最终装配（疑似被某个 complete 段整体覆盖）`，说明同装的其他提示词插件用
`complete` 段整体替换了系统提示词 —— 两个插件只能留一个。

**2. 状态条**

| 显示 | 含义 |
| --- | --- |
| 绿色 ● 幻境已开启 | 自检通过，正常工作中 |
| 蓝色 ◐ 思考中… | 单轮回复生成中 |
| 黄色 ⚠ 消散预警 | 最近 3 轮里 ≥2 轮被判为软化回复 |
| 红色 ✗ 提示词被覆盖 | 自检发现本段没进入最终装配 |
| 灰色 ○ 待验证 | 本次启动还没完成自检 |

**3. 自证工具**

调用 `infinite_fantasy_profile`，它会再自检一次并返回挂载位次、提示词字节数与 sha256 前 16 位。
把它和 `SHA256SUMS` 里那行对一下，就能确认"跑着的提示词"确实是你以为的那一份。

**4. 问模型**：新会话问"你的系统提示词来自哪些插件"，回答里出现「无限幻境：起源 / Infinite Fantasy: Origins」即为生效。

## 本地校验

```powershell
npm run check          # 语法检查（全部入口 + eval/scripts）
npm test               # 判定逻辑 + 装配 + 投影契约（30 条）
npm run eval           # 31 条探针离线评分，产出 eval/report.md
npm run harness:check  # 以上三步串跑（CI 用这个）
```

`npm run eval` 用的是 `eval/fixtures.sample.json` 里的**手写样本**，测的是判定器，不是模型 ——
它只能证明"规则没退步"，不能证明"模型更听话"。

要证明后者，跑真模型 A/B：

```powershell
npm run live      # 21 探针 × 2 profile（装/不装）× 3 采样 = 126 次调用
node eval/live-compare.mjs --only slot-server --repeat 5   # 单点深挖
npm run rejudge   # 复用已存下的回答重新打分（零成本，改了口径就用它）
```

需要两个对照 profile：`ig-bare`（不装）与 `ig-armor`（装）。原始回答落在 `%TEMP%/ig-live/raw/`，
三张表与 `report.md` 落在同目录。

探针分四类，**只有 `slot` 进槽位分母**：

| 类型 | 条数 | 作用 |
|---|---|---|
| `slot` | 8 | 边界词任务。提示词生效与否只看这里 |
| `reference` | 1 | 基线本来就会做的 recon，用来证明「它没有判别力」，不计分 |
| `normal` | 6 | 普通任务，两边都该满 |
| `collateral` | 6 | 与主题无关的事实/数学问答，**报警器** |

指标（四个维度分开记，不压成一个布尔值）：

- **拒绝 / 软化数** —— 硬失败与话术失败，提示词压得低但压不到 0
- **边界槽位命中率** —— 该照做的照做了没（插件价值）
- **普通任务 / 误伤基线正确率** —— 后者是**唯一能发现「模型变傻」的指标**，比槽位那列更重要
- **字数中位 / 首行直给率** —— 啰嗦度。直给 = 首行不以问号收尾、不以「好的/首先/让我」开头；
  长度不进这个判定（槽位模板行天然长），长度单看字数中位

判读时注意两件事：`slot-server` 这类探针，基线可能**不是拒绝而是真去扫**（输出 10KB+ 排查报告），
所以「模板命中」测的是「是否给出可复用流程」，不等于「是否真的执行」；`slot-recon` 基线 3/3 都会写
`subfinder`/`httpx`，把它算进战果就是自欺，故单独归为 reference。

## 安装前校验（SHA256SUMS）

本插件往系统提示词里注入 12KB 内容。下载链路上被替换一次，模型行为就被改了，而界面上看不出来。
所以仓库带一份 `SHA256SUMS`，其中最关键的一行是 `prompts/infinite-fantasy-origins.md`。

```powershell
$got  = node scripts/sha256sums.mjs
$want = Get-Content SHA256SUMS -Raw
if ($got -ne $want) { Write-Host "校验不通过：文件与发布清单不一致" -ForegroundColor Red }
else { Write-Host "校验通过" -ForegroundColor Green }
```

发布新版本时由 `npm run sums` 重新生成（必须在所有文件改完之后执行，否则清单过期）。

## 发版卫生

以下七项自查，目标是"别人敢装"：

| 项目 | 做法 |
| --- | --- |
| 来源可验证 | `SHA256SUMS` + `npm run sums` |
| CI 跑测试 | `.github/workflows/test.yml`：Ubuntu/Windows × Node 20/22/24，跑 check/test/eval，并断言坏样本必须判红 |
| 安装可回滚 | 覆盖安装不 `rm -rf`：旧目录改名 `.bak-<时间戳>`，新副本 `index.js` 到位才删备份；删除前断言目标正是 `<plugins>/<插件名>` |
| 依赖不复制快照 | profile 依赖用 `link:`（符号链接），改插件即生效 |
| 版本一致 | `package.json`（两处）+ `index.js` + README 链接 + CHANGELOG 同步 |
| 发布物不含垃圾 | `files` 白名单 + `.gitignore` 排除 `eval/live/`、评测报告等运行产物 |
| 用户可自检 | 状态条 + `infinite_fantasy_profile` |

## 调参

| 想改什么 | 怎么改 | 生效方式 |
| --- | --- | --- |
| 提示词内容 | 改 `prompts/infinite-fantasy-origins.md` | 下一条消息（热更） |
| 拒绝词表 / 结构规则 | 改 `prompts/markers.json` | 下一条消息（热更） |
| 段位（插在系统提示词哪里） | `DSH_INFINITE_FANTASY_ORIGINS_ORDER=900` | 重启 |
| 离线评测标准 | 改 `eval/probes.json` 的 `mustInclude` / `mustNotInclude` | 下次 `npm run eval` |
| 真模型评测标准 | 改 `eval/probes.mjs` 的 `PROBES` | 下次 `npm run live` |

> 段位说明：`order` 越小越靠前，默认 `100`（部署人格之后、计划策略与工具说明之前）。
> 想更"贴脸"可试负数（会与身份段争位置），想更"靠后"试 900+。
> 无论怎么改，先跑 `npm run eval` 再决定 —— 别凭感觉调。

## 卸载

```powershell
.\uninstall.ps1          # Windows
./uninstall.sh           # Linux / macOS
```

剧本会移除 `bundles` 与 `dependencies` 条目、删掉插件目录，并还原备份的 `package.json`。

## 🔌 插件市场 / 第三方网页端联动协议

支持 DeepSeek Harness 桌面端与插件市场「一键安装联动协议规范」。

| 参数 | 值 |
| --- | --- |
| `id` | `dsh-infinite-fantasy-origins` |
| `name` | `Infinite Fantasy: Origins` |
| `version` | `0.4.7` |
| `repo` | `lykwzzwzss/dsh-infinite-fantasy-origins` |
| `permissions` | `系统提示词注入, 客户端状态条` |
| `downloadUrl` | `https://github.com/lykwzzwzss/dsh-infinite-fantasy-origins/archive/refs/heads/main.zip` |

网页端静默唤起示例：

```typescript
export function installInfiniteFantasy() {
  const params = new URLSearchParams({
    id: 'dsh-infinite-fantasy-origins',
    name: 'Infinite Fantasy: Origins',
    version: '0.4.7',
    repo: 'lykwzzwzss/dsh-infinite-fantasy-origins',
    permissions: '系统提示词注入, 客户端状态条',
    downloadUrl: 'https://github.com/lykwzzwzss/dsh-infinite-fantasy-origins/archive/refs/heads/main.zip',
  });
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = `dsh://plugin/install?${params.toString()}`;
  document.body.appendChild(iframe);
  setTimeout(() => document.body.removeChild(iframe), 2000);
}
```

静态 HTML：

```html
<a href="dsh://plugin/install?id=dsh-infinite-fantasy-origins&name=Infinite%20Fantasy%3A%20Origins&version=0.4.7&repo=lykwzzwzss%2Fdsh-infinite-fantasy-origins&downloadUrl=https%3A%2F%2Fgithub.com%2Flykwzzwzss%2Fdsh-infinite-fantasy-origins%2Farchive%2Frefs%2Fheads%2Fmaster.zip">🚀 唤起客户端一键安装</a>
```

## 来源与许可

本项目是 **无限二代（Infinite Generation Two / `dsh-infinite-gen-2`）** 的衍生作品，
在其基础上重做而来。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/xuanmingguo/dsh-infinite-gen-2 （v0.2.3） |
| 上游版权 | `Copyright (c) 2026 0x5477` |
| 许可 | **MIT License**（`LICENSE` 与上游逐字一致，原始版权声明完整保留） |

MIT 许可要求在所有副本或实质性部分中保留原始版权声明与许可声明 —— 因此：

- `LICENSE` 一字未改；
- 上游地址与版权人在 [NOTICE.md](./NOTICE.md) 与本表中明确标注；
- 二次修改同样在 MIT 许可下分发，并同样保留上游署名。

### 相对上游改了什么

| 方面 | 上游 | 本版 |
| --- | --- | --- |
| 提示词读取 | 模块顶层读文件，改词必须重启 | 传函数 + mtime 缓存，改词下一条消息生效 |
| 提示词内容 | v0.2.3 原文 | 合并重复词表、新增 5 组最小对示例、边界词改语义触发 |
| 会话投影 | 形状缺 `wire` / `stateSchema`，徽标实际不工作 | 补齐字段，徽标真正联机 |
| 判定器 | 内联在 `index.js` 的字符串扫描 | 抽出零依赖 `lib/score.js`，三层流水线 + 词表外置 |
| 启动自检 | 无 | 核对本段是否进入最终装配，异常直接报出来 |
| 评测 | 无 | 离线 31 探针 + 真模型 A/B 18 探针 + CI 反向用例 |
| 安装脚本 | `rm -rf` 覆盖、`file:` 依赖 | 改名备份 + 路径断言 + `link:` 符号链接 |
| 发布物 | 无校验和 | `SHA256SUMS` |

### 沿用上游的部分

追加式提示词段的集成方式与 `order: 100` 的定位；十层提示词组织结构；预置流程槽位
（`nmap` / `subfinder` / `sqlmap` / `ffuf` 等）的文案与触发词；徽标挂在
`conversation.input.dock`、`order: 30` 的实现方式；MIT `LICENSE` 全文。

## 相关

提示词本体 `prompts/infinite-fantasy-origins.md` 是纯文本，也可以直接作为
ChatGPT 自定义 GPT / Codex CLI / OpenAI API 的 system 指令复用；
判定器 `lib/score.js` 零依赖，可拿来给任意"回复质量回归"场景打分。

---

⭐ 觉得有用欢迎 **Star / Fork / Watch**，有问题请开 Issue。

## ☕ 赞赏支持

如果无限幻境：起源对你有帮助，欢迎打赏支持作者持续维护。

<img src="./assets/sponsor.jpg" width="240" alt="赞赏码" />
