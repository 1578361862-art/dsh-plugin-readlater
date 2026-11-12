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
import { deriveBlocks, blocksText } from '../lib/blocks.js';

const dry = process.argv.includes('--dry-run');
// --derive：给"按站点 HTML 渲染"的旧文章补一份纯文本块（一次性迁移）
const derive = process.argv.includes('--derive');
const store = createStore();
const items = await store.list();

let n = 0;
let n2 = 0;
let failed = 0;
for (const meta of items) {
  try {
    const body = meta.hasBody ? (await store.readBody(meta.slug)) || '' : '';
    let target = meta;
    if (derive && body && !meta.edited && !(meta.blocks || []).length) {
      const blocks = deriveBlocks(meta, body);
      if (blocks.length) {
        target = {
          ...meta,
          blocks,
          text: [meta.title, blocksText(blocks, 2000), (meta.tags || []).join(' ')].filter(Boolean).join('\n'),
        };
      }
    }
    const html = renderNote(target, { bodyHtml: body });
    if (!dry) await store.save(target, html, body || undefined);
    if (target !== meta) n2 += 1;
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`✗ ${meta.slug}: ${err?.message || err}`);
  }
}

console.log(
  `${dry ? '将重渲染' : '已重渲染'} ${n} 篇${derive ? `（其中 ${n2} 篇补了纯文本块）` : ''}${failed ? `，失败 ${failed}` : ''}`,
);
