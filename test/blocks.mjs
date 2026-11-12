#!/usr/bin/env node
/**
 * 内容块自检：派生、渲染、投影、清洗。
 *
 *   node test/blocks.mjs
 */

import {
  deriveBlocks, blocksToHtml, blocksToMarkdown, blocksText, normalizeBlocks,
} from '../lib/blocks.js';

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
};

/* ---------- 图文：文案分段 + 图片 ---------- */
const gallery = {
  layout: 'gallery',
  desc: '第一段。\n\n第二段。\n\n',
  assets: [
    { kind: 'image', file: 'img-01.webp', w: 1080, h: 1440 },
    { kind: 'image', file: 'img-02.webp' },
    { kind: 'video', file: null },
  ],
};
const gb = deriveBlocks(gallery);
check('图文切出两段', gb.filter((b) => b.type === 'p').length === 2);
check('图文带两张图', gb.filter((b) => b.type === 'img').length === 2);
check('视频素材不进块', !gb.some((b) => b.file === null));

/* ---------- 长文：只认结构，压平其它 ---------- */
const article = { layout: 'article', desc: '', assets: [{ kind: 'image', file: 'img-01.webp' }] };
const ab = deriveBlocks(
  article,
  '<section><p>第一段</p><h2>小标题</h2><blockquote>引用</blockquote><img src="assets/img-01.webp"><table><tr><td>表格</td></tr></table></section>',
);
check('长文保留段落', ab.some((b) => b.type === 'p' && b.text === '第一段'));
check('长文识别标题', ab.some((b) => b.type === 'h' && b.text === '小标题'));
check('长文识别引用', ab.some((b) => b.type === 'quote' && b.text === '引用'));
check('长文识别图片', ab.some((b) => b.type === 'img' && b.file === 'img-01.webp'));
check('表格被压平成段落', ab.some((b) => b.type === 'p' && b.text.includes('表格')));

/* ---------- 短行合并 ---------- */
const m1 = deriveBlocks(
  { layout: 'article', desc: '', assets: [] },
  '<section>很短的一行</section><section>接着的内容。</section>',
);
check('短行并成一段', m1.length === 1 && m1[0].text === '很短的一行接着的内容。', JSON.stringify(m1.map((b) => b.text)));

const m2 = deriveBlocks(
  { layout: 'article', desc: '', assets: [] },
  '<section>一句还没说完，</section><section>这里接着说。</section>',
);
check('逗号结尾续写', m2.length === 1 && m2[0].text.endsWith('这里接着说。'), JSON.stringify(m2.map((b) => b.text)));

const m3 = deriveBlocks(
  { layout: 'article', desc: '', assets: [] },
  '<section>一句完整的话</section><section>。</section>',
);
check('孤立标点并回上一段', m3.length === 1 && m3[0].text === '一句完整的话。', JSON.stringify(m3.map((b) => b.text)));

const m4 = deriveBlocks(
  { layout: 'article', desc: '', assets: [] },
  '<p><span style="font-size: 30px">大标题</span></p><section>正文第一句。</section>',
);
check('大字识别为小标题', m4[0]?.type === 'h' && m4[0].text === '大标题', JSON.stringify(m4));

const m5 = deriveBlocks(
  { layout: 'article', desc: '', assets: [] },
  '<p>一段</p><img src="assets/a.webp"><p>二段</p>',
);
check(
  '图片挪到末尾',
  m5[m5.length - 1].type === 'img' && m5[0].type === 'p' && m5[0].text.includes('一段'),
  JSON.stringify(m5.map((b) => b.type)),
);

/* ---------- 渲染 ---------- */
const html = blocksToHtml([
  { type: 'p', text: '带 <script> 的文字' },
  { type: 'h', text: '标题' },
  { type: 'quote', text: '引用' },
  { type: 'img', file: 'img-01.webp', w: 100, h: 200 },
]);
check('HTML 转义生效', html.includes('&lt;script&gt;') && !html.includes('<script>'));
check('标题渲染成 h2', html.includes('<h2>标题</h2>'));
check('引用渲染成 blockquote', html.includes('<blockquote>引用</blockquote>'));
check('图片走相对 assets/', html.includes('src="assets/img-01.webp"'));
check('图片带宽高比', html.includes('aspect-ratio:100/200'));

/* ---------- 投影 ---------- */
const md = blocksToMarkdown(
  [
    { type: 'p', text: '段落' },
    { type: 'img', file: 'img-01.webp' },
    { type: 'h', text: '小节' },
    { type: 'quote', text: '引用' },
  ],
  'ab12cd34',
);
check('Markdown 图片路径带 id8', md.includes('![](assets/ab12cd34/img-01.webp)'));
check('Markdown 标题是二级', md.includes('## 小节'));
check('Markdown 引用带 >', md.includes('> 引用'));

/* ---------- 纯文本 ---------- */
check('纯文本不含图片', !blocksText([{ type: 'p', text: 'x' }, { type: 'img', file: 'a' }]).includes('a'));

/* ---------- 清洗 ---------- */
const cleaned = normalizeBlocks(
  [
    { type: 'p', text: '  ' },
    { type: 'p', text: '留下' },
    { type: 'img', file: 'img-01.webp', w: 10, h: 20 },
    { type: 'img', file: '不存在.webp' },
    { type: 'weird', text: '未知类型降级为正文' },
    { type: 'img', file: '' },
  ],
  ['img-01.webp'],
);
check('空文本被丢', !cleaned.some((b) => b.text === ''));
check('不存在的图片被丢', !cleaned.some((b) => b.file === '不存在.webp'));
check('未知类型降级为正文', cleaned.some((b) => b.type === 'p' && b.text.includes('未知类型')));
check('合法图片保留宽高', cleaned.some((b) => b.file === 'img-01.webp' && b.w === 10 && b.h === 20));

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
