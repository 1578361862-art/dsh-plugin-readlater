#!/usr/bin/env node
/**
 * 面板筛选/搜索单测。用 __ModuleLoader__ 垫片把 client.js 装进来，
 * 直接测纯函数 filterItems —— 不必起浏览器。
 *
 *   node test/filter.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const src = fs.readFileSync(path.join(repo, 'lib/client.js'), 'utf8');

const Mini = {
  createElement() {
    return { type: 'div', props: {} };
  },
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect() {},
  useRef: (v) => ({ current: v ?? null }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
};

let captured = null;
new Function('window', 'document', 'fetch', 'console', src)(
  { __ModuleLoader__: { load: (d) => { captured = d; } } },
  { head: { appendChild() {} }, createElement: () => ({ remove() {}, set textContent(_) {} }) },
  () => Promise.reject(new Error('no network')),
  console,
);
const mod = captured.factory((id) => (id === 'react' ? Mini : {}));
const { filterItems, isDirty } = mod.__test__;

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
};

const items = [
  { slug: 'a', title: 'STUDIYO 用大字做学习APP', author: 'Troy', siteName: '小红书', snippet: '半调网屏 印刷', tags: ['设计'], status: 'unread', projectedAt: null },
  { slug: 'b', title: '微信公众号排版', author: '某人', siteName: '微信公众号', snippet: '行距与字号', tags: ['排版'], status: 'read', projectedAt: '2026-11-09', contentHash: 'h1', projectedHash: 'h1' },
  { slug: 'c', title: '一篇改过的', author: '', siteName: '小红书', snippet: '', tags: [], status: 'unread', projectedAt: '2026-11-08', contentHash: 'h2', projectedHash: 'h1' },
];

check('空查询返回全部', filterItems(items, '', 'all').length === 3);
check('按标题搜', filterItems(items, 'studi', 'all').map((x) => x.slug).join() === 'a');
check('按作者搜', filterItems(items, 'troy', 'all').map((x) => x.slug).join() === 'a');
check('按正文摘要搜', filterItems(items, '半调', 'all').map((x) => x.slug).join() === 'a');
check('按标签搜', filterItems(items, '排版', 'all').map((x) => x.slug).join() === 'b');
check('搜索大小写不敏感', filterItems(items, 'STUDIYO', 'all').length === 1);
check('搜不到时为空', filterItems(items, 'zzz', 'all').length === 0);

check('未读筛选', filterItems(items, '', 'unread').map((x) => x.slug).join() === 'a,c');
check('已同步筛选', filterItems(items, '', 'synced').map((x) => x.slug).join() === 'b,c');
check('有更新筛选', filterItems(items, '', 'dirty').map((x) => x.slug).join() === 'c');

check('筛选与搜索叠加', filterItems(items, '半调', 'unread').map((x) => x.slug).join() === 'a');
check('筛选与搜索叠加后可为空', filterItems(items, '半调', 'synced').length === 0);
check('查询两端空白被忽略', filterItems(items, '  troy  ', 'all').length === 1);

check('isDirty 认得出内容变过', isDirty(items[2]) === true);
check('isDirty 对未投影为 false', isDirty(items[0]) === false);
check('isDirty 对一致为 false', isDirty(items[1]) === false);

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
