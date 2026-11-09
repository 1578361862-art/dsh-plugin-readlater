#!/usr/bin/env node
/**
 * 公众号解析离线自检：喂一段按真实结构写的 HTML，不联网。
 *
 *   node test/wechat-offline.mjs
 *
 * 图片刻意指向 127.0.0.1:9（必然失败），用来验证
 * "单张图挂掉不影响整篇、破图会被摘掉" 这条降级路径。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readArticle } from '../lib/wechat.js';

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
};

const ARTICLE = `<!doctype html><html><head>
<meta property="og:title" content="测试文章标题">
<meta property="og:description" content="这是摘要">
<meta property="weixin:account" content="测试公众号">
</head><body>
<h1 id="activity-name">测试文章标题</h1>
<a id="js_name">测试公众号</a>
<em id="publish_time">2026年11月9日 10:30</em>
<div id="js_content" class="rich_media_content">
  <p style="color:#333">第一段正文</p>
  <p><img data-src="http://127.0.0.1:9/a.jpg" src=""></p>
  <p><a href="javascript:alert(1)">坏链接</a></p>
  <script>alert('xss')</script>
</div>
</body></html>`;

const PICTURE = `<!doctype html><html><head>
<meta property="og:title" content="一组图">
</head><body>
<div class="rich_media_content" id="js_content"></div>
<script>window.cgiDataNew = {"item_show_type":"8","picture_page_info_list":[{"cdn_url":"http://127.0.0.1:9/p1.jpg"},{"cdn_url":"http://127.0.0.1:9/p2.jpg"}]};</script>
</body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-wx-'));
const assetsDir = path.join(dir, 'assets');

/* ---------- 普通文章 ---------- */
const a = await readArticle('https://mp.weixin.qq.com/s/test', { assetsDir, html: ARTICLE });
check('识别为 article', a.kind === 'article', a.kind);
check('标题来自 #activity-name', a.title === '测试文章标题', a.title);
check('公众号名来自 #js_name', a.siteName === '测试公众号', a.siteName);
check('发布时间解析正确', a.published === new Date(2026, 10, 9, 10, 30).toISOString(), a.published);
check('摘要来自 og:description', a.desc === '这是摘要', a.desc);
check('正文保留段落', a.bodyHtml.includes('第一段正文'));
check('正文里没有 script', !/<script/i.test(a.bodyHtml));
check('data-src 已换成 src 或已摘除', !a.bodyHtml.includes('data-src'));
check('javascript: 链接被清掉', !a.bodyHtml.includes('javascript:'));
check('普通 inline style 保留', /color:\s*#333/.test(a.bodyHtml));
check('图片下载失败被记录', a.failed.length === 1, String(a.failed.length));
check('失败的图从正文摘除', !a.bodyHtml.includes('127.0.0.1:9'));
check('via 标记为 fixture', a.via === 'fixture', a.via);

/* ---------- 图片消息 ---------- */
const g = await readArticle('https://mp.weixin.qq.com/s/pic', { assetsDir: path.join(dir, 'g'), html: PICTURE });
check('识别为 gallery', g.kind === 'gallery', g.kind);
check('相册取到 2 个地址', g.images.length === 2, String(g.images.length));
check('相册图下载失败被记录', g.failed.length === 2, String(g.failed.length));
check('gallery 不产出 bodyHtml', g.bodyHtml === '');

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
