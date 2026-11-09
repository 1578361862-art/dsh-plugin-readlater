/**
 * 站点 HTML 的清洗与图片本地化。
 *
 * 为什么必须真清洗：微信这类正文只能原样保留 DOM（排版全在 inline style 里），
 * 而这段 HTML 会被丢进同源 iframe 渲染。一个 <img onerror> 就能在 DSH 的
 * 源上跑脚本 —— 所以走白名单，不用正则抠。
 *
 * 用 linkedom 而不是自己写正则：嵌套标签必须真解析，否则「删掉一个 div」
 * 会连结构一起删歪。
 */

import path from 'node:path';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import { download, sniffExt, extFromMime, extOfUrl } from './media.js';

/** 直接整棵删掉的标签：要么能执行、要么能加载外部资源、要么是表单。 */
const DROP = new Set([
  'script', 'style', 'link', 'meta', 'noscript', 'template',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'textarea', 'select', 'option',
  'svg', 'canvas', 'audio-source',
  'base', 'title', 'head',
]);

/** 允许保留的标签；不在名单里的元素会被"脱壳"（保留子节点，去掉标签）。 */
const ALLOW = new Set([
  'p', 'br', 'span', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'small', 'mark', 'sub', 'sup',
  'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'img', 'figure', 'figcaption', 'picture',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'code', 'pre', 'hr', 'video', 'source',
]);

const ATTR = new Set([
  'href', 'src', 'alt', 'title', 'width', 'height',
  'colspan', 'rowspan', 'scope', 'align', 'valign', 'border', 'cellpadding', 'cellspacing',
  'style', 'target', 'rel', 'poster', 'controls', 'preload', 'muted', 'playsinline',
  'loading', 'decoding', 'sizes', 'srcset', 'data-src', 'data-original',
]);

const SAFE_SCHEME = /^(https?:|mailto:|tel:|#|\/)/i;

function cleanStyle(style) {
  const s = String(style || '');
  if (s.length > 2000) return '';
  // url() / expression() / 定位劫持：这三类能加载外链或盖住整个界面
  if (/url\s*\(|expression\s*\(|javascript:|position\s*:\s*fixed|position\s*:\s*sticky/i.test(s)) {
    return s.replace(/position\s*:\s*(fixed|sticky)\s*;?/gi, '');
  }
  return s;
}

function safeUrl(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.startsWith('data:')) return null;
  if (SAFE_SCHEME.test(s)) return s;
  return null;
}

/**
 * 解析一段 HTML 片段，返回可操作的 root。
 * @returns {{document: Document, root: Element}}
 */
export function parseBody(html) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="__rl_root">${String(html || '')}</div></body></html>`);
  return { document, root: document.getElementById('__rl_root') };
}

/** 就地清洗：删危险节点、过滤属性、脱掉不在白名单里的标签。 */
export function sanitizeBody(root) {
  // 1. 整棵删掉危险标签
  for (const tag of DROP) {
    for (const el of Array.from(root.querySelectorAll(tag))) el.remove();
  }

  // 2. 自底向上处理，避免边遍历边改树
  const all = Array.from(root.querySelectorAll('*')).reverse();
  for (const el of all) {
    const tag = String(el.tagName || '').toLowerCase();

    // 属性白名单
    for (const attr of Array.from(el.attributes || [])) {
      const name = attr.name.toLowerCase();
      if (!ATTR.has(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style') {
        const cleaned = cleanStyle(attr.value);
        if (cleaned) el.setAttribute('style', cleaned);
        else el.removeAttribute('style');
        continue;
      }
      if (name === 'href' || name === 'src' || name === 'poster') {
        const u = safeUrl(attr.value);
        if (!u) el.removeAttribute(name);
        else el.setAttribute(name, u);
        continue;
      }
      if (name === 'srcset') el.removeAttribute('srcset'); // 懒加载改写后再拼
    }

    // 外链在新标签打开，且不泄露 referrer
    if (tag === 'a' && el.getAttribute('href')) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noreferrer noopener');
    }

    if (!ALLOW.has(tag)) {
      // 脱壳：把子节点提上来，丢掉标签本身
      const parent = el.parentNode;
      if (!parent) continue;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      el.remove();
    }
  }
  return root;
}

/** 把懒加载图换成真 src，返回可下载的图片节点。 */
export function revealLazyImages(root) {
  const out = [];
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const real =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('src') ||
      '';
    if (!real) {
      img.remove();
      continue;
    }
    img.setAttribute('src', real);
    img.removeAttribute('data-src');
    img.removeAttribute('data-original');
    out.push(img);
  }
  for (const v of Array.from(root.querySelectorAll('video'))) {
    const src = v.getAttribute('src') || v.querySelector('source')?.getAttribute('src');
    if (src) v.setAttribute('src', src);
  }
  return out;
}

/**
 * 下载正文里的图片，改写成相对路径。
 * 单张失败就删掉那个 <img>（留个破图比没有更难看），并记进 failed。
 */
export async function localizeImages(imgNodes, assetsDir, { ua, referer, startIndex = 1, log = () => {} } = {}) {
  fs.mkdirSync(assetsDir, { recursive: true });
  const assets = [];
  const failed = [];
  let n = startIndex - 1;

  for (const img of imgNodes) {
    const src = img.getAttribute('src');
    if (!src) continue;
    n += 1;
    const stem = `img-${String(n).padStart(2, '0')}`;
    try {
      const { buf, contentType } = await download(src, { ua, referer });
      const ext = sniffExt(buf) || extFromMime(contentType) || extOfUrl(src);
      const file = `${stem}${ext}`;
      fs.writeFileSync(path.join(assetsDir, file), buf);
      const w = Number(img.getAttribute('width')) || undefined;
      const h = Number(img.getAttribute('height')) || undefined;
      img.setAttribute('src', `assets/${file}`);
      img.removeAttribute('width');
      img.removeAttribute('height');
      if (!img.getAttribute('loading')) img.setAttribute('loading', 'lazy');
      assets.push({ file, bytes: buf.length, kind: 'image', mime: contentType || null, w, h });
      log(`img ${n} ${Math.round(buf.length / 1024)}KB ${ext}`);
    } catch (err) {
      failed.push({ url: src, error: String(err?.message || err) });
      log(`img ${n} 失败：${err?.message || err}`);
      img.remove();
    }
  }
  return { assets, failed };
}

export function toHtml(root) {
  return String(root.innerHTML || '').trim();
}
