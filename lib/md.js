/**
 * Markdown 作为内容真源。
 *
 * 块层（p/h/quote/img）只能表达四种东西，列表和代码块存不下；
 * 这里把 md 直接当存储格式：渲染时 md → HTML，编辑时 HTML → md（turndown）。
 */
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function imgTag(src, alt, assets) {
  const file = String(src || '').replace(/^\.?\//, '').replace(/^assets\//, '');
  const hit = (assets || []).find((a) => a.file === file);
  const w = hit && hit.w ? ' width="' + hit.w + '"' : '';
  const h = hit && hit.h ? ' height="' + hit.h + '"' : '';
  const ratio = hit && hit.w && hit.h ? ' style="aspect-ratio:' + hit.w + '/' + hit.h + '"' : '';
  return '<img src="assets/' + esc(file) + '" alt="' + esc(alt || '') + '" loading="lazy"' + w + h + ratio + '>';
}

/** 行内标记：先转义，再按固定顺序替换，避免 ** 被 * 吃掉。 */
function inline(text, assets) {
  let s = esc(text);
  const slots = [];
  const hold = (html) => { slots.push(html); return '\u0000' + (slots.length - 1) + '\u0000'; };
  s = s.replace(/`([^`]+)`/g, (_, code) => hold('<code>' + code + '</code>'));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => hold(imgTag(src, alt, assets)));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => hold('<a href="' + href + '" target="_blank" rel="noreferrer">' + label + '</a>'));
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, b) => hold('<strong>' + b + '</strong>'));
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, (_, pre, i) => pre + hold('<em>' + i + '</em>'));
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

export function mdToHtml(md, { assets = [] } = {}) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^[ ]*\`\`\`/.test(line)) {
      const lang = line.replace(/^[ ]*\`\`\`/, '').trim();
      const body = [];
      i += 1;
      while (i < lines.length && !/^[ ]*\`\`\`/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      out.push('<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(body.join('\n')) + '</code></pre>');
      continue;
    }

    if (/^[ ]*([-*_][ ]*){3,}$/.test(line)) { out.push('<hr>'); i += 1; continue; }

    const head = line.match(/^[ ]{0,3}(#{1,6})[ ]+(.*)$/);
    if (head) {
      const level = Math.min(head[1].length, 3);
      out.push('<h' + level + '>' + inline(head[2].trim(), assets) + '</h' + level + '>');
      i += 1;
      continue;
    }

    if (/^[ ]{0,3}>/.test(line)) {
      const body = [];
      while (i < lines.length && /^[ ]{0,3}>/.test(lines[i])) {
        body.push(lines[i].replace(/^[ ]{0,3}>[ ]?/, ''));
        i += 1;
      }
      out.push('<blockquote>' + inline(body.join('\n'), assets).replace(/\n/g, '<br>') + '</blockquote>');
      continue;
    }

    const img = line.match(/^[ ]*!\[([^\]]*)\]\(([^)\s]+)\)[ ]*$/);
    if (img) { out.push('<figure class="rl-figure">' + imgTag(img[2], img[1], assets) + '</figure>'); i += 1; continue; }

    if (/^[ ]{0,3}([-*+][ ]+|\d+[.][ ]+)/.test(line)) {
      const ordered = /^[ ]{0,3}\d+[.][ ]+/.test(line);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      while (i < lines.length && /^[ ]{0,3}([-*+][ ]+|\d+[.][ ]+)/.test(lines[i])) {
        items.push('<li>' + inline(lines[i].replace(/^[ ]{0,3}([-*+][ ]+|\d+[.][ ]+)/, '').trim(), assets) + '</li>');
        i += 1;
      }
      out.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^[ ]*(\`\`\`|#{1,6}[ ]|>|!\[[^\]]*\]\([^)]+\)[ ]*$|[-*+][ ]|\d+[.][ ])/.test(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    if (!buf.length) { i += 1; continue; }
    out.push('<p>' + inline(buf.join('\n'), assets).replace(/\n/g, '<br>') + '</p>');
  }

  return out.join('\n');
}

const turndown = new TurndownService({
  headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**',
});
turndown.use(gfm);
turndown.addRule('figure', {
  filter: 'figure',
  replacement: (_content, node) => {
    const img = node.querySelector('img');
    if (!img) return '';
    return '\n\n![' + (img.getAttribute('alt') || '') + '](' + (img.getAttribute('src') || '') + ')\n\n';
  },
});
turndown.addRule('img', {
  filter: 'img',
  replacement: (_c, node) => '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')',
});

export function htmlToMd(html) {
  const cleaned = String(html || '')
    .replace(/\s+src="[^"]*\/asset\/[^/]+\/([^"]+)"/g, ' src="assets/$1"')
    .replace(/\s+srcset="[^"]*"/g, '');
  return turndown.turndown(cleaned).replace(/\n{3,}/g, '\n\n').trim();
}

export function mdText(md, limit = 2000) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ ]{0,3}(#{1,6}|>|[-*+])\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, limit);
}
