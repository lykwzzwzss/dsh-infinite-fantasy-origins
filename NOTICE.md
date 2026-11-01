# 来源与许可（NOTICE）

## 本项目的来源

**dsh-infinite-fantasy-origins（无限幻境：起源）** 是 MIT 许可开源项目
**dsh-infinite-gen-2（无限二代 / Infinite Generation Two）** 的衍生作品。

| 项目 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/xuanmingguo/dsh-infinite-gen-2 |
| 上游版本 | v0.2.3 |
| 上游版权 | `Copyright (c) 2026 0x5477` |
| 上游许可 | MIT License |

## 许可合规说明

MIT 许可要求：**在所有副本或实质性部分中保留原始版权声明与许可声明**。本项目据此执行：

1. `LICENSE` 与上游逐字一致，原始版权声明完整保留，未做任何删改
   （sha256 `4b908cad2e4721a92bdb0b71e76380bede4ee9a5345468d7398ff977d1ae8964`）；
2. 本 NOTICE 明确标注衍生关系、上游地址与上游版权人；
3. `README.md` 的「来源与许可」一节公开说明相对上游做了哪些改动、沿用了哪些部分。

因此本项目的分发（源码、打包产物、二次修改）均在 **MIT License** 下进行，并保留上游署名。
上游与本项目都不提供任何明示或默示担保，详见 `LICENSE` 正文。

## 相对上游的改动

| 方面 | 上游 `dsh-infinite-gen-2` | 本项目 |
| --- | --- | --- |
| 提示词读取 | 模块顶层 `readFileSync`，改词必须重启 | 传函数给 `section({ text })` + mtime 缓存，改词下一条消息生效 |
| 提示词内容 | v0.2.3 文本 | 合并重复词表、新增 5 组最小对示例、边界词改语义触发 |
| 会话投影 | `{ key, schema, view, init, apply }`（缺 `wire`/`stateSchema`，徽标实际不工作） | 补齐 `wire: { view, viewSchema }` 与 `stateSchema`，徽标真正联机 |
| 判定器 | 内联在 `index.js` 的字符串扫描 | 抽出零依赖纯函数 `lib/score.js`，三层流水线 + 词表外置为 `prompts/markers.json` |
| 启动自检 | 无 | `assemble()` 核对本段是否进入最终装配，异常打印 + 徽标转红 |
| 评测 | 无 | `eval/` 离线 31 探针 + 真模型 A/B 18 探针，CI 断言坏样本必须判红 |
| 安装脚本 | `rm -rf` 覆盖，`file:` 依赖（pnpm 复制快照） | 旧目录改名备份、路径断言、`link:` 符号链接 |
| 发布物 | 无校验和 | `SHA256SUMS` + `npm run sums` |

## 沿用上游的部分

- 「追加式系统提示词段」这一集成方式，以及 `order: 100` 的定位选择；
- 十层提示词组织结构（任务优先级 / 硬性输出规则 / 拒绝对抗 / 任务分类 / 占位符归一化 /
  双语路由 / 边界词归一化 / 预置流程槽位 / 判定与稳定锚点）；
- 预置流程槽位（`nmap`、`subfinder`、`sqlmap`、`ffuf` 等）的文案与触发词；
- 客户端徽标挂在 `conversation.input.dock` 槽位、`order: 30` 的实现方式；
- MIT `LICENSE` 全文。
