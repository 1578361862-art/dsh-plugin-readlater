# 稍后阅读 · dsh-plugin-readlater

> 粘一条分享链接，正文和图片落到本地。读的时候不联网，也不经过任何模型。

![DSH](https://img.shields.io/badge/DSH-%E2%89%A5%200.2.1--rc.5-4f46e5?style=flat-square)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-339933?style=flat-square?logo=nodedotjs)
![License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)

小红书的图文、微信公众号的长文，分享链接粘进去就在本机解析：正文抽成干净 HTML，图片视频一并缓存，左栏出卡片、右边直接读。没有账号，没有云端，没有模型调用。

想留下来的那一篇，点「同步到 Obsidian」投影成笔记——正文、图片、标签、索引一起过去。

## 安装

```sh
dsh plugin --profile <profile> add https://github.com/1578361862-art/dsh-plugin-readlater/releases/latest/download/dsh-plugin-readlater.tgz
```

`<profile>` 换成你实际的 profile 名：DSH Desktop 是 `desktop`，`dsh web` 一般是 `web`。装完重启 DSH。

也可以从仓库源码装（本插件没有构建步骤）：

```sh
dsh plugin --profile <profile> add github:1578361862-art/dsh-plugin-readlater
```

**需要一对东西**：Node ≥ 20，以及一个可用的 Chrome（微信公众号的正文要渲染一次）。默认找 `/Applications/Google Chrome.app`，没有的话用 `READLATER_CHROME` 指一个可执行文件。

## 用法

1. 左侧栏点「稍后阅读」
2. 把分享链接——或者整段分享文案——粘进输入框，回车
3. 解析完左边出卡片，右边直接读

分享文案原样粘贴即可，不需要自己挑 URL：

```
56 【两个颜色，把照片印成海报】 😆 ...
http://xhslink.com/a/AbCdEf，复制本条信息，打开【小红书】App查看精彩内容！
```

列表支持**搜索**（标题 / 作者 / 站点 / 正文摘要 / 标签，纯本地）和**筛选**（全部 · 未读 · 已同步 · 有更新）。点「批量」进多选：勾几篇 → 「同步 N 篇」一次投影，也可以「全选」当前筛选结果。

输入框右侧的「缓存视频」是全局开关：默认只存直链和封面，勾上才会把视频下到本地。

## 支持哪些源

| 源 | 通道 | 状态 |
|---|---|---|
| 小红书 | 分享链 + 无头 Chrome 读 `__INITIAL_STATE__` | ✅ 已通 |
| 微信公众号 | HTTP 优先 → 撞 verify 壳则浏览器渲染 → `#js_content` | ✅ 已通（连续请求会被限流） |
| 抖音 | 短链 → `iesdouyin` 的 `_ROUTER_DATA` | 待接 |
| 知乎 | 必须带 cookie 的浏览器（纯 HTTP 403） | 待接 |

冷却状态落在 `~/Data/readlater/state/throttle.json`，重启不清零；成功抓取后自动清零。
`GET /readlater/api/state` 会带 `throttle` 字段，面板在提示条上显示"微信冷却中 · 还剩 …"。

## 为什么必须走分享链接

裸笔记 URL 一律被风控（curl 404 / `error_code 300031`；无登录无头 Chrome 报 300012）。
只有 App/网页**分享出来**的链接带 `xsec_token`，那个 token 就够匿名读全文。

所以归一化层里 `xsec_token` 是白名单保留项，不会被"清理跟踪参数"顺手删掉。

## 阅读排版

整页**只用一套衬线家族**（俪宋 LiSong Pro），标题和正文靠字号分层次——这是杂志的做法，不是"标题一种字体、正文另一种"。

正文基线：**18px / 行高 1.9 / 字距 +.02em / measure 32rem**；标题 1.76em 并 `text-wrap: balance`。

> 改排版模板**不会自动更新旧文章**：阅读页是渲染时把 CSS 一起写进 `content.html` 的。
> 改完样式跑 `node scripts/rerender.mjs` 重渲染一遍（只读本地，不联网、不碰 Obsidian）。

站点原文（微信）的 inline style 会做一次**排版归一**（`lib/sanitize.js`）：

| 处理 | 原因 |
|---|---|
| 去掉 `font-family` / `line-height` / `letter-spacing` | 各号排版不同，放行就像从三个 App 里截出来的 |
| `font-size` 只保留 15–40px | 太小的交给正文，太夸张的交给标题层级 |
| 保留颜色 / 对齐 / 间距 / 边框 | 这些是排版意图，不该被抹掉 |

## 公众号：只取文字

公众号文章**不保留原站排版**——颜色、居中、字号、行内样式全部丢掉，只留文字。
图片也不再穿插在段落之间，统一收到正文末尾（读完文字再看图，或者进编辑器一键清空）。

派生规则（`lib/blocks.js`）：

| 规则 | 说明 |
|---|---|
| 逐元素取文字 | 只认文字内容，不认 `style` |
| 短行合并 | 上一行 < 30 字且没有句末标点，就和下一行并成一段（微信习惯一句一个 `<section>`，不并会碎成清单） |
| 大字当标题 | 祖先链上 `font-size ≥ 20px` 的行按小标题处理，避免大标题被并进正文 |
| 图片后置 | 全部收集到末尾，正文先读通 |

## 编辑内容

详情页「编辑」进入块编辑器。内容被表示成四种块——**段落 / 小标题 / 引用 / 图片**：

- 删掉不需要的图片（这是主要用途），↑↓ 调顺序
- 直接改文字，改完「保存」
- 标题也能改
- 「还原原文」丢掉编辑，回到解析时的内容

保存后立刻重渲染阅读页；**已投影的会顺手重投一次**，Obsidian 里的文件跟着变。

两条边界值得知道：

- **长文（公众号）第一次编辑会把格式压平**——表格压成段落、行内加粗/颜色会丢。这是刻意的取舍：富文本编辑器的成本远大于收益，而你的实际需求是删图和理字。
- **「重新解析」会丢弃编辑**，所以会先确认；确认后才真正重抓。

数据上，块存在 `meta.blocks`。一旦存在，它就**取代** `desc` / `bodyHtml` 成为正文的真源——渲染和投影都从块来。

## 设置

刊头右侧齿轮打开：

| 项 | 说明 |
|---|---|
| 收藏时默认缓存视频 | 关掉后新收藏只存图文；单条仍可临时覆盖 |
| 数据目录 | 只读展示 + 「打开」；换库等于换一套历史，不做一键搬迁 |
| Obsidian | 库根路径可改，清空回到自动探测；下面写着投影到的子目录 |

设置存 `~/Data/readlater/settings.json`，是唯一来源：投影、默认行为都读它。

## 任务队列与提示

抓取是串行的，所以面板上有一条**任务指示器**（刊头右侧）：

- 圆环 + 数字 = 正在处理（进行中 + 排队中）
- 点开是列表：每条显示标题、进行到哪一步（`缓存图片 12/21` / `排队中`）
- 完成后指示器变成 ✓，并在右下角弹一次提示，4 秒后自己消失
- **不再有常驻的状态行**——提示只出现在任务结束的那一刻

## 选择

点工具行右侧的「选择」进入选择模式：方块整体右移让出位置，对勾从左滑入（0.18s），
筛选栏就地换成「全选 N · 标签 · 同步 · 删除 · 取消」。

选完能做什么：

| 动作 | 说明 |
|---|---|
| 标签 | 给选中的每一篇加同一个标签（已投影的会顺手重投） |
| 同步 | 批量投影到 Obsidian |
| 删除 | 本地 + vault 一起清，带二次确认 |
| 全选 | 选当前**筛选结果**里的全部，所以「先筛未读 → 全选 → 同步」是顺的 |

## 标签

详情页标题下方是一条标签带：点 `+ 标签` 输入回车即可加，点 `×` 删。改完立刻落盘；
**已投影的会顺手重投一次**，Obsidian 里的文件和索引跟着变（vault 不可用时只存本地，不会因此失败）。

## 删除

详情页「删除」会删掉本地目录（含图片）；**如果这篇已经投影，会先把 Obsidian 里的笔记和素材一起撤下**，不留孤儿。
批量模式下也有「删除 N 篇」。

## 投影到 Obsidian

投影是**手动**的：解析完先留在本地，你想留下哪篇再点「同步到 Obsidian」。

```
90.同步/ReadLater/
  阅读索引.md                  ← managed 头 + 全部条目的 wikilink
  <标题>--<id8>.md             ← 一篇一个文件
  assets/<id8>/img-01.webp     ← 正文图片，按条目分目录
```

- 每个文件头都写 `managed_by: "readlater"` / `managed: true`，和 `90.同步/BookTutor` 同一套约定：**这块目录是生成的，不要手改**。
- 文件名带 `--<id8>` 后缀（id 的 8 位哈希）：标题会改，id 不会。投影先按 id 找旧文件再改写，改标题不会在 vault 里留下两个条目。
- **写进笔记的原文链接是规范化后的干净地址**：分享链里的 `xsec_token` 是一次性凭证，抓取时必须有，落进 vault 就是泄露。
- `contentHash` 在解析时算一次，`projectedHash` 在投影时记一次；两者不等就在面板上标「有更新」。
- 长文（微信）走 turndown 转 Markdown；图文（小红书）直接「文案 + 图片序列」，本来就没有文章结构，硬转反而难看。

vault 路径按 环境变量 `READLATER_VAULT` > `~/Data/readlater/config.json` 的 `vault` > 默认 iCloud 路径 解析。

## 数据在哪

```text
~/Data/readlater/
  library/<platform>-<id>/
    meta.json       记录、标签、资源清单
    content.html    清洗后的正文（唯一真源）
    assets/         图片、视频
  profile/          无头 Chrome 的持久 profile
```

没有数据库：几百篇的量 `readdir` 足够。`content.html` 里用相对路径，整个目录可以原样搬走。存储根可以用 `READLATER_ROOT` 改。

## 投影到 Obsidian

投影是**手动**的：解析完先留在本地，想留哪篇再点「同步」。

```
90.同步/ReadLater/
  阅读索引.md                  ← managed 头 + 全部条目的 wikilink
  <标题>--<id8>.md             ← 一篇一个文件
  assets/<id8>/img-01.webp     ← 正文图片，按条目分目录
```

文件里写 `managed_by: "readlater"` / `managed: true`，和 BookTutor 那套约定一致：这块目录是生成的，不要手改。标题会改、`<id8>` 不会，所以改标题不会在 vault 里留下两个条目。

vault 路径按 `READLATER_VAULT` > `~/Data/readlater/config.json` 的 `vault` > 默认 iCloud 路径 解析。

## 卸载

```sh
dsh plugin --profile <profile> remove dsh-plugin-readlater
```

插件删掉，`~/Data/readlater` 里已经抓下来的东西还在；不想要就一起删。

## 从别处搬收藏

支持从 InRead（或任何能导出 JSON 清单的地方）批量导入，失败可重试、撞限流即停。见 [docs/IMPORT.md](docs/IMPORT.md)。

## 自测

```bash
npm ci
node test/local.mjs     # 小红书夹具：归一化 + 渲染，不联网
node test/host.mjs      # 假 ctx 起宿主：路由、MIME、越权、错误分支
node test/project.mjs   # 投影：版面、幂等、改标题不留旧文件、撤销
node test/throttle.mjs  # 限流刹车：间隔、指数冷却、跨实例落盘
```

其余用例见 `test/`。

## 实现

抓取通道（微信为什么要过浏览器、限流怎么刹车）、投影与清理的取舍见 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)；阅读页的排版与配色见 [docs/DESIGN.md](docs/DESIGN.md)。

一句话：正文是我们自己拼的，不存站点 DOM，所以没有 XSS 面，也就不需要 sanitizer；图片按字节嗅探格式，不信扩展名。

## 许可

[MIT](LICENSE) © Yee
