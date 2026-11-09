# 稍后阅读（dsh-plugin-readlater）

粘贴一条分享链接 → 本地解析 → 图文卡片阅读。**不经过任何模型**，图片视频跟正文一起缓存，数据全在本地。

当前接了**小红书**和**微信公众号**。知乎 / 抖音的位置已经留好（见「路线」）。

## 用法

1. 左侧栏点「稍后阅读」
2. 把小红书的分享链接——或者整段分享文案——粘进输入框，回车
3. 解析完成后左边出卡片，右边直接读

列表支持**搜索**（标题 / 作者 / 站点 / 正文摘要 / 标签，纯本地）和**筛选**（全部 · 未读 · 已同步 · 有更新）。
点「批量」进入多选：勾几篇 → 「同步 N 篇」一次投影；也可以「全选」当前筛选结果。

输入框右侧的「缓存视频」是全局开关（记在 localStorage）：默认只存直链和封面，勾上才会把视频下到本地。

分享文案原样粘贴即可，不需要自己挑 URL：

```
56 【两个颜色，把照片印成海报】 😆 ...
http://xhslink.com/a/AbCdEf，复制本条信息，打开【小红书】App查看精彩内容！
```

## 为什么微信要过浏览器

文档说公众号正文在服务端 HTML 里（`#js_content`），实际上（2026-11 实测）：
**纯 HTTP 不管用桌面 UA 还是微信移动端 UA，拿到的都是同一个 17 KB 的
`secitptpage/verify` JS 壳**，正文要等挑战脚本跑完才出现。

所以微信走两级：先试 HTTP（快），拿不到 `#js_content` 就开无头 Chrome 渲染一遍。
渲染那一步还有两条硬经验：

1. **不要复用浏览器 profile。** 同一个 profile 访问几次微信，它会给
   「环境异常，完成验证后即可继续访问」；一次性 profile 反而直接放行。
2. **被 kill 的 Chrome 会留下死锁。** `SingletonLock` 是个指向
   `<hostname>-<pid>` 的符号链接，进程没了链接还在，Chrome 会
   "Aborting now to avoid profile corruption" 永久拒绝这个目录。
   而且悬空链接用 `fs.existsSync` 判断会返回 false（它跟随链接）——
   必须 `readlinkSync` 看本体，确认同机且 pid 已死就回收。

## 微信的限流刹车

微信撞一次验证会越撞越久，所以这里不是"失败重试三次"，而是三件更保守的事（`lib/throttle.js`）：

| 机制 | 值 | 目的 |
|---|---|---|
| 请求间隔 | 15 秒 | 压住触发概率；间隔内再来会等一小会儿或直接拒绝 |
| 指数冷却 | 撞一次 2 分钟，之后 4 / 8 … 上限 30 分钟 | 冷却期内**不再发请求** |
| 快速失败 | 冷却中直接报"还剩几分几秒" | 避免把封锁撞深 |

冷却状态落在 `~/Data/readlater/state/throttle.json`，重启不清零；成功抓取后自动清零。
`GET /readlater/api/state` 会带 `throttle` 字段，面板在提示条上显示"微信冷却中 · 还剩 …"。

## 为什么必须走分享链接

裸笔记 URL 一律被风控（curl 404 / `error_code 300031`；无登录无头 Chrome 报 300012）。
只有 App/网页**分享出来**的链接带 `xsec_token`，那个 token 就够匿名读全文。

所以归一化层里 `xsec_token` 是白名单保留项，不会被"清理跟踪参数"顺手删掉。

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

```
~/Data/readlater/
  library/<platform>-<id>/
    meta.json       记录、标签、资源清单
    content.html    清洗后的正文（唯一真源）
    assets/         图片、视频
  profile/          无头 Chrome 的持久 profile
```

没有数据库：几百篇的量 `readdir` 足够。将来要全文检索再上 SQLite 索引，那是**派生**物，删了能重建。

`content.html` 里用的是相对路径（`assets/img-01.webp`），所以整个目录可以原样搬走；
将来同步到 Obsidian 就是 `cp -R`，不需要改写正文。

## 视觉

跟随 `~/Code/dsh-panel-kit` 的《自建面板设计规范》：同纸、同墨、同信号色、同刊头。

| 层 | 日版 | 夜版 |
|---|---|---|
| 纸 | `#faf6ee` | `var(--dsw-alias-bg-base, #151517)`（跟随宿主） |
| 卡片（阅读页、输入框、iframe） | `#fffcf6` | `#232324` |
| 第二纸（图版占位、阅读区底） | `#f1eadc` | `#1b1c1e` |
| 第三纸（悬停、选中） | `#f5eee2` | `#2c2c2e` |
| 墨（主 / 次 / 弱） | `#1b1813` / `#4b453a` / `#7f7666` | `#f9fafb` / `#cfd3d6` / `#81858c` |
| 发丝线 / 署名线 | `.14` / `.62` | `.06` / `.12` |
| 信号色（唯一点缀） | `#a8452f` | `#ff6363` |

**主题切换点**：`@media (prefers-color-scheme: dark)`。阅读页（iframe 内）与面板各自独立跟随系统；
宿主若以后提供主题属性，两处一起换成同一选择器即可。

**控制件几何**：`--pk-*` 拷贝自 `panel-kit/panel-kit.css`，用 `@panel-kit:begin/end` 标出边界。
`panel-kit/check.mjs` 目前还没把这块面板登记进 `panels.json`，所以 `--fix` 不会覆盖它；
登记之后记得同步。

排版上的几条取舍：

- 一屏只有一个实心按钮（「收藏」），其余都是描边或安静按钮。
- 列表里不标「本地」——那是默认状态，标出来只是噪音；只标「视频」和「已同步」。
- 阅读页标题用衬线（`Iowan Old Style / Songti SC`），正文用系统 UI 字体 17px/1.78，measure 34rem；
  标题下方一条署名线，是这块面板的版面签名。
- 图片整列竖排、圆角统一 8，与控件同一套圆角；首图不 lazy。

## 设计上的几个决定

| 决定 | 原因 |
|---|---|
| HTML 是阅读形态，Markdown 是投影形态 | 小红书这类「文案 + 九宫格」本来就没有文章结构，硬转 md 会丢排版 |
| 图片按**字节**嗅探格式，不信扩展名 | `sns-webpic-qc.xhscdn.com` 的 URL 以 `.jpg` 结尾，返回的却是 WebP |
| 正文字我们自己拼，不存站点 DOM | 没有 XSS 面，也就不需要 sanitizer |
| 串行队列 | 一次只解析一条，风控风险低，进度可轮询 |
| 首图不 lazy | 打开就出图，避免一屏灰块 |

## 自测

```bash
node test/local.mjs          # 小红书夹具：归一化 + 渲染，不联网
node test/host.mjs           # 假 ctx 起宿主：路由、路径改写、MIME、越权、错误分支
node test/sanitize.mjs       # 清洗器：脚本/事件属性/javascript:/iframe 全部拦住
node test/wechat-offline.mjs # 公众号：article 与 gallery 两条分支，含图片失败降级
node test/project.mjs        # 投影：版面、幂等、改标题不留旧文件、撤销、HTML→MD
node test/filter.mjs         # 面板搜索/筛选纯函数：关键词命中面、三档筛选、叠加
node test/throttle.mjs       # 限流刹车：间隔、指数冷却、跨实例落盘、可读时长
node test/panel.mjs          # 面板静态渲染，产出 .tmp/readlater-preview/panel.html
```

`local.mjs` 会顺手把一份预览写到 `.tmp/readlater-preview/<slug>/content.html`。

## 路线

| 源 | 通道 | 状态 |
|---|---|---|
| 小红书 | 分享链 + 无头 Chrome 读 `__INITIAL_STATE__` | ✅ 已通 |
| 微信公众号 | HTTP 优先 → 撞 verify 壳则浏览器渲染 → `#js_content` + `data-src` | ✅ 已通（连续请求会被限流） |
| 抖音 | 短链 → `iesdouyin` 的 `_ROUTER_DATA` | 待接 |
| 知乎 | 必须带 cookie 的浏览器（纯 HTTP 403） | 待接 |
| Obsidian 投影 | 手动触发，按 id 匹配改写 + 图片随行 | ✅ 已通 |
