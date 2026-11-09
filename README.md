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

**只支持分享出来的链接。** 裸笔记 URL 一律被风控；分享链里带的 `xsec_token` 才是通行证。写进笔记的链接是清理过的干净地址——一次性凭证不会落进你的 vault。

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
