#!/usr/bin/env node
/**
 * 面板静态预览：用 __ModuleLoader__ 垫片把 client.js 跑起来，取 Main 组件渲染成 HTML。
 *
 *   node test/panel.mjs        → 写 .tmp/readlater-preview/panel.html
 *
 * 这不是真浏览器验收（交互、iframe、轮询都没跑），只是把静态结构和样式渲染出来，
 * 好在接入 DSH 之前先看一眼排版有没有崩。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const src = fs.readFileSync(path.join(repo, 'lib/client.js'), 'utf8');

/* ---------- 迷你 React ---------- */

const Mini = {
  createElement(type, props, ...children) {
    const p = { ...(props || {}) };
    const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);
    if (kids.length) p.children = kids.length === 1 ? kids[0] : kids;
    return { type, props: p };
  },
  useState(init) {
    const i = Mini.__hookIndex = (Mini.__hookIndex || 0) + 1;
    if (SEED && i === 1) return [SEED.items, () => {}];
    if (SEED && i === 2) return [SEED.active, () => {}];
    const v = typeof init === 'function' ? init() : init;
    return [v, () => {}];
  },
  useEffect() {},
  useRef(v) {
    return { current: v ?? null };
  },
  useCallback(fn) {
    return fn;
  },
  useMemo(fn) {
    return fn();
  },
};

/* ---------- 预览数据 ---------- */

const previewRoot = path.resolve(repo, '../.tmp/readlater-preview');
const fixtureDir = path.join(process.env.HOME, 'Work/dsh/default-workspace/.tmp/xhs/6aed25de000000000900f771');
const fixtureHas = fs.existsSync(path.join(fixtureDir, 'note.json'));

const SEED = {
  active: 'xhs-6aed25de000000000900f771',
  items: [
    { slug: 'xhs-6aed25de000000000900f771', title: '两个颜色，把照片印成海报', author: '羔羊',
      saved: new Date(Date.now() - 3600e3).toISOString(), layout: 'gallery', platformLabel: '小红书',
      mediaBytes: 4192680, assetCount: 9, projectedAt: null, thumb: 'img-01.webp' },
    { slug: 'xhs-demo2', title: 'AI 生成的版式，为什么一眼假', author: '设计杂货铺',
      saved: new Date(Date.now() - 30 * 3600e3).toISOString(), layout: 'gallery', platformLabel: '小红书',
      mediaBytes: 1820000, assetCount: 6, projectedAt: new Date().toISOString(), thumb: null },
    { slug: 'xhs-demo3', title: '用一张网屏，把整面墙印成一张图', author: '半调研究所',
      saved: new Date(Date.now() - 5 * 86400e3).toISOString(), layout: 'video', platformLabel: '小红书',
      mediaBytes: 22600000, assetCount: 1, projectedAt: null, thumb: null },
  ],
};

/* ---------- 假 window / document ---------- */

let captured = null;
const fakeWindow = {
  __ModuleLoader__: { load: (def) => { captured = def; } },
  confirm: () => false,
};
const fakeDocument = {
  head: { appendChild() {} },
  createElement: () => ({ set textContent(v) {}, remove() {}, id: '' }),
};
const fakeFetch = () => Promise.reject(new Error('preview 不联网'));

/* ---------- 装载插件 ---------- */

new Function('window', 'document', 'fetch', 'console', src)(fakeWindow, fakeDocument, fakeFetch, console);
if (!captured) {
  console.error('client.js 没有调用 __ModuleLoader__.load');
  process.exit(1);
}
const mod = captured.factory((id) => {
  if (id === 'react') return Mini;
  throw new Error(`unexpected require: ${id}`);
});

let Main = null;
let SideIcon = null;
const ctx = {
  effect() {},
  slots: {
    inject(_name, fn) { fn(); },
    register(_opts, Comp) {
      if (Comp && Comp.name === 'Main') Main = Comp;
      else if (Comp && Comp.name === 'SidebarIcon') SideIcon = Comp;
      return () => {};
    },
  },
};
mod.apply(ctx);

if (!Main) {
  console.error('没有注册 Main 组件');
  process.exit(1);
}

/* ---------- 序列化 ---------- */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function styleOf(obj) {
  return Object.entries(obj || {})
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`)
    .join(';');
}

function render(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return esc(node);
  if (Array.isArray(node)) return node.map(render).join('');
  if (!node || !node.type) return '';
  const { type, props } = node;

  if (typeof type === 'function') {
    // 组件：直接调用（hooks 已被替换成无副作用的桩）
    return render(type(props));
  }

  const attrs = [];
  let children = props.children;
  for (const [k, v] of Object.entries(props)) {
    if (k === 'children' || v === undefined || v === null) continue;
    if (k === 'style' && typeof v === 'object') { attrs.push(`style="${esc(styleOf(v))}"`); continue; }
    if (k === 'className') { attrs.push(`class="${esc(v)}"`); continue; }
    if (typeof v === 'function' || typeof v === 'boolean') continue;
    if (k === 'ref') continue;
    attrs.push(`${k}="${esc(v)}"`);
  }
  const a = attrs.length ? ' ' + attrs.join(' ') : '';
  if (type === 'input' || type === 'img' || type === 'br') return `<${type}${a}>`;
  return `<${type}${a}>${render(children)}</${type}>`;
}

Mini.__hookIndex = 0;
const tree = Main({});
const css = mod.__test__?.CSS || '';
const viewFile = path.join(previewRoot, SEED.active, 'content.html');
const withLocal = (h) => h
  .replace(/src="\/readlater\/api\/view\/[^"]*"/, `src="file://${viewFile}"`)
  .replace(/src="\/readlater\/api\/asset\/xhs-6aed25de000000000900f771\/img-01\.webp"/,
           `src="file://${path.join(previewRoot, SEED.active, 'assets', 'img-01.webp')}"`);

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
html,body{margin:0;height:100%;font-family:-apple-system,"PingFang SC",sans-serif}
body{background:#f7f5f1}
${css}
/* 预览用：给个固定画布，模拟面板里的尺寸 */
/* 宽度交给窗口，才能验 900 / 720 断点；上限只是模拟大屏 */
.rl-root{width:100%;max-width:1080px;height:680px;border:1px solid #ddd;border-radius:10px;overflow:hidden;margin:16px auto}
</style></head><body>${withLocal(render(tree))}</body></html>`;

const outDir = path.resolve(repo, '../.tmp/readlater-preview');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'panel.html'), html, 'utf8');
console.log(`面板预览：${outDir}/panel.html`);
console.log(`节点数：${(html.match(/<[a-z]+/g) || []).length}`);
