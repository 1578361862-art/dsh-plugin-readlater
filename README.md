# 稍后阅读（dsh-plugin-readlater）

粘贴一条分享链接 → 本地解析 → 图文卡片阅读。**不经过任何模型**，图片视频跟正文一起缓存，数据全在本地。

当前只接了**小红书**。微信 / 知乎 / 抖音的适配器位置已经留好（见「路线」）。

## 用法

1. 左侧栏点「稍后阅读」
2. 把小红书的分享链接——或者整段分享文案——粘进输入框，回车
3. 解析完成后左边出卡片，右边直接读

分享文案原样粘贴即可，不需要自己挑 URL：

```
56 【两个颜色，把照片印成海报】 😆 ...
http://xhslink.com/a/AbCdEf，复制本条信息，打开【小红书】App查看精彩内容！
```

## 为什么必须走分享链接

裸笔记 URL 一律被风控（curl 404 / `error_code 300031`；无登录无头 Chrome 报 300012）。
只有 App/网页**分享出来**的链接带 `xsec_token`，那个 token 就够匿名读全文。

所以归一化层里 `xsec_token` 是白名单保留项，不会被"清理跟踪参数"顺手删掉。

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
node test/local.mjs   # 用 .tmp/xhs 里的真实笔记夹具验证归一化 + 渲染，不联网
node test/host.mjs    # 假 ctx 起宿主，验路由、路径改写、MIME、越权与错误分支
```

`local.mjs` 会顺手把一份预览写到 `.tmp/readlater-preview/<slug>/content.html`。

## 路线

| 源 | 通道 | 状态 |
|---|---|---|
| 小红书 | 分享链 + 无头 Chrome 读 `__INITIAL_STATE__` | ✅ 已通 |
| 微信公众号 | 移动端 UA + `#js_content` + `data-src` | 待接 |
| 抖音 | 短链 → `iesdouyin` 的 `_ROUTER_DATA` | 待接 |
| 知乎 | 必须带 cookie 的浏览器（纯 HTTP 403） | 待接 |
| Obsidian 投影 | 手动触发，`cp -R` + 生成 md | 待做 |
