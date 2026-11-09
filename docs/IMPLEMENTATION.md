# 抓取、投影与设计取舍

面向改代码的人。安装和用法见 README。

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

