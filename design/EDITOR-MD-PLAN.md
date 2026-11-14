# 稍后阅读 · 编辑功能重做：Markdown 作为内容真源

> 目标：点「编辑」直接改全文（一个输入框），不再按段落块逐块操作；解析结果统一成 Markdown，渲染与编辑共用同一份文本。

## 一、现状（2026-11-14 核实）

| 环节 | 现状 | 位置 |
|---|---|---|
| 存储 | 每篇一个目录：`meta.json` + `content.html` + `body.html` + `assets/` | `~/Data/readlater/library/<slug>/` |
| 内容真源 | `meta.blocks`（数组，只有 p / h / quote / img 四种） | `lib/blocks.js`（210 行） |
| 渲染 | `blocksToHtml` → 塞进带 CSS 的 `content.html` → iframe | `lib/render.js:247` |
| 编辑 | 逐块 patch / 上下移 / 删 / 加文字，浮层式 | `lib/client.js:879–1050`（约 170 行） |
| 接口 | `GET /blocks`、`POST /blocks`、`POST /blocks/reset` | `lib/index.js:496–530` |
| 投影 | `blocksToMarkdown` 已经产出 Obsidian 用的 md | `lib/blocks.js:163` |
| 依赖 | 已有 `turndown` + `turndown-plugin-gfm`（转 md 用） | `package.json` |

关键观察：**Markdown 的半套基础设施已经存在**——投影本来就在生成 md，只是没被当作真源。所以这次不是从零引入 md，而是把它从「导出格式」提升为「存储格式」。

## 二、三种方案

### A. Markdown 成为真源（推荐）

`meta.md`（字符串）替代 `meta.blocks`；渲染走 md → HTML；编辑就是一个 textarea。

- 存储：`meta.md`
- 渲染：`mdToHtml(meta.md)`（支持 p / h2 / h3 / blockquote / 图片 / 有序无序列表 / 代码块 / 粗斜体 / 链接 / 分隔线）
- 编辑：一个等宽 textarea，可选双栏预览
- 迁移：`blocks → md` 一次性转换（逻辑已有），26 篇文章

**代价**：约 550 行改动，6–9 小时。

### B. Markdown 只作为编辑视图（blocks 仍是真源）

打开时 blocks → md，保存时 md → blocks。UI 改动小，但**双向转换有损**（md 的列表/代码块在四种块里没有对应），且每次保存都要做一次解析。不推荐。

### C. 保留 blocks，加「全文模式」

把块文字拼成一个 textarea，保存时按空行重新切段。约 1 小时，但会**丢标题/引用/图片的结构**——恰是用户最想控制的三样。只在时间极紧时考虑。

## 三、方案 A 的拆分与工时

### 阶段 1 · 后端引入 md（3h）

| 任务 | 产出 | 估时 |
|---|---|---|
| 新 `lib/md.js`：md→HTML（含图片宽高、列表、代码块、转义） | 150–200 行 | 2h |
| `render.js` 改走 `mdToHtml`，保留 blocks 回退读 | 15 行 | 0.5h |
| `index.js`：`GET/POST /doc`、contentHash 与 `meta.text` 由 md 派生 | 60 行 | 0.5h |

### 阶段 2 · 迁移（1.5h）

| 任务 | 内容 | 估时 |
|---|---|---|
| `scripts/migrate-md.mjs` | `blocks → md` 写回 `meta.md`，保留原 `blocks` 一个版本 | 60 行 / 0.5h |
| 跑 26 篇 + 逐篇抽查渲染 | 比对迁移前后 HTML 段落数 | 1h |

### 阶段 3 · 编辑器重做（2.5h）

| 任务 | 内容 | 估时 |
|---|---|---|
| 新 `MarkdownEditor` | 全宽 textarea + 保存/取消/重置 + 未保存拦截 | 150 行 / 1.5h |
| 预览 | 右栏实时渲染（复用 `mdToHtml`，不再走 iframe） | 50 行 / 1h |
| 删除旧块编辑器 | −170 行 | 0.5h |

### 阶段 4 · 收尾（1h）

| 任务 | 内容 |
|---|---|
| 测试 | `test/md.mjs`：转义、图片、列表、代码块、空文档（约 100 行） |
| 投影简化 | `project.js` 直接用 `meta.md`，不再过 blocksToMarkdown |
| 清理 | 删 `/blocks` 接口与 `deriveBlocks` 的写路径（保留读回退） |

**合计：约 550 行，6–9 小时，含验证一天内可完成。**

## 四、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 图片路径与尺寸 | md 里只有 `![](assets/x.webp)`，丢失宽高，渲染可能跳版 | `mdToHtml` 用 `meta.assets` 回填 width/height/aspect-ratio |
| 旧数据 | 已有 `meta.blocks` 的文章 | 迁移脚本 + 读取时「有 md 用 md，否则 blocks」双轨一版 |
| 微信原文结构 | 原文的彩色 section、居中、表格会被压平 | 与现状一致（blocks 本来就只留四种），无回退 |
| 搜索与投影哈希 | `meta.text` / contentHash 依赖 blocks | 迁移时重算，`text` 从 md 抽 |
| 大文档编辑卡顿 | 3000 字以上 textarea | 先不做高亮；必要时再接 CodeMirror |

## 五、待定问题

1. 编辑器要不要**实时预览**（双栏），还是默认纯文本、按一下看预览？
2. 是否需要支持**列表与代码块**（微信文章里「1，2，3」这类步骤很多，md 列表比段落更可读）？
3. 图片在编辑器里显示为 `![](assets/img-01.webp)` 还是缩略图卡片？

确认后按阶段 1 → 4 执行，每阶段结束跑一次 `node test/*.mjs` 并在真机点一遍。
