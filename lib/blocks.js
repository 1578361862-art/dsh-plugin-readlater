/**
 * 内容块：文章的可编辑表示。
 *
 * 为什么需要这一层：`content.html` 是渲染产物，直接改它会在下次渲染时被冲掉。
 * 所以引入一个中间层——段落 / 标题 / 引用 / 图片——它才是"用户改过的内容"的真源：
 *
 *   meta.blocks 存在时 → 渲染从块来、投影也从块来
 *   meta.blocks 不存在 → 仍然走原来的 desc / bodyHtml（首次进入编辑时生成）
 *
 * 块的结构刻意做得很小（只有四种），因为真正的需求是"删掉不要的图、把文字重新理一遍"，
 * 不是做一个富文本编辑器。保留 inline 加粗之类的代价太大，收益很小。
 */

import { parseHTML } from 'linkedom';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const BLOCK_TYPES = ['p', 'h', 'quote', 'img'];

/** 从纯文本（小红书的 desc）切段。空行是分段依据。 */
function splitParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * 生成初始块。
 *
 * - 图文（gallery）：文案分段 + 图片按资产顺序排在后面（小红书本来就是这个结构）
 * - 站点长文（article）：遍历正文顶层节点，只认 p / h1–h4 / blockquote / img，
 *   其余（表格、嵌套 section）压平成段落——第一次进编辑器时会提示"格式会简化"
 */
export function deriveBlocks(meta, bodyHtml = '') {
  const blocks = [];

  if (meta.layout === 'article' && bodyHtml) {
    // 延迟引入，只有长文才需要解析 DOM
    return deriveFromHtml(bodyHtml, meta.assets || []);
  }

  for (const p of splitParagraphs(meta.desc)) blocks.push({ type: 'p', text: p });
  for (const a of meta.assets || []) {
    if (a.kind === 'image' && a.file) blocks.push({ type: 'img', file: a.file, w: a.w, h: a.h });
  }
  return blocks;
}

function deriveFromHtml(html, assets) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${html}</div></body></html>`);
  const root = document.getElementById('root');
  const blocks = [];
  const known = new Set((assets || []).map((a) => a.file));

  const walk = (node) => {
    for (const el of Array.from(node.children || [])) {
      const tag = String(el.tagName || '').toLowerCase();

      if (tag === 'img') {
        const src = String(el.getAttribute('src') || '');
        const file = src.replace(/^assets\//, '');
        if (file && (known.size === 0 || known.has(file))) {
          blocks.push({ type: 'img', file });
        }
        continue;
      }
      if (tag === 'figure' || tag === 'picture') {
        walk(el); // 里面的 img 会被上面接住
        continue;
      }
      if (/^h[1-4]$/.test(tag)) {
        const t = el.textContent.trim();
        if (t) blocks.push({ type: 'h', text: t });
        continue;
      }
      if (tag === 'blockquote') {
        const t = el.textContent.trim();
        if (t) blocks.push({ type: 'quote', text: t });
        continue;
      }
      if (tag === 'p') {
        const t = el.textContent.trim();
        if (t) blocks.push({ type: 'p', text: t });
        continue;
      }
      if (tag === 'pre') {
        const t = el.textContent.trim();
        if (t) blocks.push({ type: 'quote', text: t });
        continue;
      }
      if (tag === 'table') {
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t) blocks.push({ type: 'p', text: t });
        continue;
      }
      // section / div 之类：往下钻；叶子节点没子元素就当段落
      if (el.children && el.children.length) {
        walk(el);
      } else {
        const t = el.textContent.trim();
        if (t) blocks.push({ type: 'p', text: t });
      }
    }
  };

  walk(root);
  return blocks;
}

/** 块 → 阅读页 HTML（不含外层容器）。 */
export function blocksToHtml(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b.type === 'img') {
      if (!b.file) continue;
      const ratio = b.w && b.h ? ` aspect-ratio:${b.w}/${b.h};` : '';
      out.push(
        `<figure class="rl-figure"><img src="assets/${esc(b.file)}" alt="" loading="lazy"${
          b.w ? ` width="${b.w}"` : ''
        }${b.h ? ` height="${b.h}"` : ''} style="background:var(--rl-paper-2);${ratio}"></figure>`,
      );
      continue;
    }
    const text = esc(b.text).replace(/\n/g, '<br>');
    if (!String(b.text || '').trim()) continue;
    if (b.type === 'h') out.push(`<h2>${text}</h2>`);
    else if (b.type === 'quote') out.push(`<blockquote>${text}</blockquote>`);
    else out.push(`<p>${text}</p>`);
  }
  return out.join('\n');
}

/** 块 → Markdown（投影用，图片路径指向 vault 的 assets/<id8>/）。 */
export function blocksToMarkdown(blocks, id8) {
  const out = [];
  for (const b of blocks || []) {
    if (b.type === 'img') {
      if (!b.file) continue;
      out.push(`![](assets/${id8}/${b.file})`, '');
      continue;
    }
    const text = String(b.text || '').trim();
    if (!text) continue;
    if (b.type === 'h') out.push(`## ${text}`, '');
    else if (b.type === 'quote') out.push(...text.split('\n').map((l) => `> ${l}`), '');
    else out.push(text, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 块 → 纯文本（搜索索引与列表摘要）。 */
export function blocksText(blocks, cap = 4000) {
  return (blocks || [])
    .filter((b) => b.type !== 'img')
    .map((b) => String(b.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, cap);
}

/** 清洗外部传入的块：只留已知类型，去掉空文本与不存在的图片。 */
export function normalizeBlocks(raw, knownFiles) {
  const known = knownFiles ? new Set(knownFiles) : null;
  const out = [];
  for (const b of Array.isArray(raw) ? raw : []) {
    const type = BLOCK_TYPES.includes(b?.type) ? b.type : 'p';
    if (type === 'img') {
      const file = String(b?.file || '');
      if (!file) continue;
      if (known && !known.has(file)) continue;
      const w = Number(b?.w) || 0;
      const h = Number(b?.h) || 0;
      out.push({ type: 'img', file, ...(w ? { w } : {}), ...(h ? { h } : {}) });
      continue;
    }
    const text = String(b?.text || '').replace(/\r\n/g, '\n').trim();
    if (!text) continue;
    out.push({ type, text: text.slice(0, 20000) });
  }
  return out.slice(0, 800);
}
