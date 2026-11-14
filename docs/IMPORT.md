# 从 InRead 搬收藏

InRead 的库在 App Group 里：`~/Library/Group Containers/group.ideaappp.inread/InRead.sqlite`（Core Data）。
先导出成清单，再跑导入：

```bash
sqlite3 -json ~/Library/Group\ Containers/group.ideaappp.inread/InRead.sqlite \
  "SELECT ZTITLE t, ZURL u, ZSITENAME s FROM ZARTICLED WHERE ZISDELETE=0 AND ZURL<>'' ORDER BY ZCREATEDAT DESC;" \
  > /tmp/inread-export/manifest.json

node scripts/import-inread.mjs --manifest /tmp/inread-export/manifest.json --status   # 只看进度
node scripts/import-inread.mjs --manifest /tmp/inread-export/manifest.json            # 跑（可中断、可续）
```

导入器的三条约束（都是踩出来的）：

- **失败可重试**：成功的跳过，失败的按 url 计数，最多重试 2 次。第一版把失败也标成"已处理"，被风控那几分钟刷出来的失败就把链接永久废掉了。
- **撞墙即停**：小红书连续读 ~30 条会把你踢回发现页（URL 变成 `/explore`、正文是"登录后推荐更懂你的笔记"）。这不是逐条失效，是一次性的 IP 级限制——这时立刻停、冷却 10 分钟，比继续撞强。
- **不假装成功**：token 过期、笔记删除、被墙，三种原因分别落盘，不写半成品。

