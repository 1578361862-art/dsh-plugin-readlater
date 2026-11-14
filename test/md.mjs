#!/usr/bin/env node
/**
 * Markdown 往返自检：渲染、转义、图片、列表、代码块、回写。
 *
 *   node test/md.mjs
 */

import { mdToHtml, htmlToMd, mdText } from '../lib/md.js';

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log((ok ? '✓ ' : '✗ ') + label + (extra ? '  ' + extra : ''));
  if (!ok) failed += 1;
};

const nl = String.fromCharCode(10);
const md = [
  '## 一、标题',
  '',
  '段落，含 **粗体**、*斜体*、`code` 与 [链接](https://example.com)。',
  '',
  '- 列表一',
  '- 列表二',
  '',
  '1. 第一步',
  '2. 第二步',
  '',
  '> 引用一句',
  '',
  '```js',
  'const a = 1 < 2;',
  '```',
  '',
  '![图](assets/img-01.webp)',
  '',
  '---',
].join(nl);

const html = mdToHtml(md, { assets: [{ file: 'img-01.webp', w: 800, h: 600 }] });

check('标题渲染为 h2', html.includes('<h2>一、标题</h2>'));
check('段落与行内标记', html.includes('<strong>粗体</strong>') && html.includes('<em>斜体</em>') && html.includes('<code>code</code>'));
check('链接带 target', html.includes('href="https://example.com"') && html.includes('rel="noreferrer"'));
check('无序列表', html.includes('<ul><li>列表一</li>'));
check('有序列表', html.includes('<ol><li>第一步</li>'));
check('引用', html.includes('<blockquote>引用一句</blockquote>'));
check('代码块带语言', html.includes('class="language-js"') && html.includes('1 &lt; 2'));
check('图片回填宽高', html.includes('width="800"') && html.includes('height="600"') && html.includes('aspect-ratio:800/600'));
check('分隔线', html.includes('<hr>'));

const back = htmlToMd(html);
check('回写保留标题', back.includes('## 一、标题'));
check('回写保留列表', /[-*]+ +列表一/.test(back) && /1[.] +第一步/.test(back));
check('回写保留代码块', back.includes('```js'));
check('回写图片为相对路径', back.includes('![图](assets/img-01.webp)'));
check('回写幂等', htmlToMd(mdToHtml(back, { assets: [{ file: 'img-01.webp', w: 800, h: 600 }] })) === back);

check('转义脚本标签', mdToHtml('<script>alert(1)</script>').includes('&lt;script&gt;'));
check('纯文本剥离标记', mdText(md).startsWith('一、标题') && !mdText(md).includes('**'));

console.log('');
if (failed) {
  console.log('失败 ' + failed + ' 项');
  process.exit(1);
}
console.log('全部通过');
