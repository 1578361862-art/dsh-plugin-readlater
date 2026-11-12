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
 * - 站点长文（article）：**只取文字**，遍历顶层节点把 p / h1–h4 / blockquote / 其余容器
 *   逐一压成纯文本段落，行内样式（颜色、居中、字号）全部丢掉；
 *   图片不再穿插在段落之间，统一收集到末尾，读的时候文字是连贯的
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

/**
 * 把一行行短句并成能读的段落。
 *
 * 微信的排版习惯是「一句话一个 <section>」，直接一段一行会碎得像清单。
 * 规则：上一行很短（< 30 字）且没有句末标点，就和这一行并起来。
 */
function mergeShortLines(lines) {
  const out = [];
  const TERM = /[。！？!?…”』」）)]$/;
  for (const item of lines) {
    const line = String(item?.text ?? item ?? '').trim();
    if (!line) continue;
    const kind = item?.kind || 'p';
    const last = out.length ? out[out.length - 1] : null;
    // 只有"普通段落"才参与并段；标题和引用各自独立
    if (kind === 'p' && last && last.kind === 'p') {
      // 微信常把句末标点单独包一个 section，会落成孤零零的「。」
      const punctOnly = /^[。，、！？；：…—》」』）)]{1,3}$/.test(line);
      // 上一段以逗号/分号结尾 = 同一句被微信拆成了两段，直接续上
      const continues = /[，、；：]$/.test(last.text);
      if (punctOnly || continues || (!TERM.test(last.text) && last.text.length < 30)) {
        last.text += line;
        continue;
      }
    }
    out.push({ text: line, kind });
  }
  return out;
}

function deriveFromHtml(html, assets) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${html}</div></body></html>`);
  const root = document.getElementById('root');
  const lines = [];
  const images = [];
  const known = new Set((assets || []).map((a) => a.file));

  const px = (node) => {
    const m = /font-size:\s*([\d.]+)px/i.exec(String(node.getAttribute?.('style') || ''));
    return m ? Number(m[1]) : 0;
  };

  // 字号常常写在祖先 span 上（微信就是这么干的），所以要沿祖先链继承下来
  const walk = (node, inherited = 0) => {
    for (const el of Array.from(node.children || [])) {
      const tag = String(el.tagName || '').toLowerCase();
      const pxHere = Math.max(inherited, px(el));

      if (tag === 'img') {
        const src = String(el.getAttribute('src') || '');
        const file = src.replace(/^assets\//, '');
        if (file && (known.size === 0 || known.has(file))) images.push({ type: 'img', file });
        continue;
      }
      if (tag === 'figure' || tag === 'picture') {
        walk(el); // 里面的 img 会被上面接住
        continue;
      }
      // 真正的标题才单独成块；其余一律按"行"收，最后再并段
      if (/^h[1-4]$/.test(tag)) {
        const t = el.textContent.trim();
        if (t) lines.push({ text: t, kind: 'h' });
        continue;
      }
      if (tag === 'blockquote') {
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t) lines.push({ text: t, kind: 'quote' });
        continue;
      }
      if (el.children && el.children.length) {
        walk(el, pxHere);
        continue;
      }
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      // 微信的"标题"往往只是加了大字号的行内 span；字号 >= 20px 就按小标题处理，
      // 免得把大标题并进正文里读成 "AppOS科技快讯：…"
      lines.push({ text: t, kind: pxHere >= 20 ? 'h' : 'p' });
    }
  };

  walk(root);
  const blocks = mergeShortLines(lines).map((l) => ({ type: l.kind, text: l.text }));
  // 图片统一放到末尾：正文先读通，图作为附页
  return blocks.concat(images);
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
