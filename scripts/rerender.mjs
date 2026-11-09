#!/usr/bin/env node
/**
 * 重新渲染所有已存文章的阅读页。
 *
 * 为什么需要：`content.html` 是渲染时把 CSS 一起写进去的整页，
 * 改排版模板不会自动影响旧文章。导入/收藏之后改过样式就跑一遍。
 *
 *   node scripts/rerender.mjs [--dry-run]
 *
 * 只读本地（body.html + meta.json），不联网、不碰 Obsidian。
 */
import { createStore } from '../lib/store.js';
import { renderNote } from '../lib/render.js';

const dry = process.argv.includes('--dry-run');
const store = createStore();
const items = await store.list();

let n = 0;
let failed = 0;
for (const meta of items) {
  try {
    const body = meta.hasBody ? (await store.readBody(meta.slug)) || '' : '';
    const html = renderNote(meta, { bodyHtml: body });
    if (!dry) await store.save(meta, html, body || undefined);
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`✗ ${meta.slug}: ${err?.message || err}`);
  }
}

console.log(`${dry ? '将重渲染' : '已重渲染'} ${n} 篇${failed ? `，失败 ${failed}` : ''}`);
