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
