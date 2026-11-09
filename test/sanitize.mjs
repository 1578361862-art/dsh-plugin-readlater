#!/usr/bin/env node
/**
 * 清洗器单测：拿一段"恶意"HTML 过一遍，确认该删的删了、该留的没丢。
 *
 *   node test/sanitize.mjs
 *
 * 这段 HTML 会被丢进同源 iframe 渲染，所以这里每一条都是真实的攻击面。
 */

import { parseBody, sanitizeBody, revealLazyImages, toHtml } from '../lib/sanitize.js';

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
};

const hostile = `
<section>
  <h2 style="color:#333;position:fixed;top:0">标题</h2>
  <script>alert(1)</script>
  <p onclick="steal()">正文 <b>加粗</b></p>
  <img src="https://mmbiz.qpic.cn/a.jpg" onerror="alert(2)" width="640">
  <img data-src="https://mmbiz.qpic.cn/b.jpg" src="">
  <a href="javascript:alert(3)">坏链接</a>
  <a href="https://example.com/x">好链接</a>
  <iframe src="https://evil.example/"></iframe>
  <form action="/steal"><input name="x"></form>
  <custom-tag>自定义标签里的文字要留下</custom-tag>
  <video src="https://mmbiz.qpic.cn/v.mp4"></video>
  <table><tr><td>单元格</td></tr></table>
</section>`;

const { root } = parseBody(hostile);
sanitizeBody(root);
const imgs = revealLazyImages(root);
const html = toHtml(root);

check('script 被删', !/<script/i.test(html));
check('iframe 被删', !/<iframe/i.test(html));
check('form/input 被删', !/<form|<input/i.test(html));
check('on* 事件属性被删', !/onerror|onclick/i.test(html));
check('javascript: 链接被去掉', !/javascript:/i.test(html));
check('position:fixed 被剥掉', !/position\s*:\s*fixed/i.test(html));
check('保留普通 style', /color:#333/.test(html));
check('未知标签脱壳但保留文字', html.includes('自定义标签里的文字要留下') && !/<custom-tag/i.test(html));
check('正常链接保留并加 noreferrer', /rel="noreferrer noopener"/.test(html));
check('表格保留', /<td>单元格<\/td>/.test(html));
// 两张都是真图：一张本来就有 src，一张靠 data-src 提上来
check('两张图都拿到 src', imgs.length === 2, String(imgs.length));
check('data-src 被提成真 src', imgs.some((i) => i.getAttribute('src').includes('b.jpg')));

const firstImg = root.querySelector('img');
check('图片上的事件属性被清掉', !!firstImg && !firstImg.getAttribute('onerror'));

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
