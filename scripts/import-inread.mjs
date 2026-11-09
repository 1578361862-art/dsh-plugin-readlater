#!/usr/bin/env node
/**
 * 把 InRead（或任何别处导出）的收藏批量搬进 readlater。
 *
 *   node scripts/import-inread.mjs --manifest /tmp/inread-export/manifest.json
 *   node scripts/import-inread.mjs --manifest ... --limit 12        # 先抽样看成功率
 *   node scripts/import-inread.mjs --manifest ... --dry-run         # 只分类，不抓
 *
 * 设计取舍：
 *   - **可续跑**：每条结果追加到 import/<date>.jsonl，重跑时已处理的自动跳过；
 *   - **不炸队列**：串行 + 间隔，一条失败不影响后面；
 *   - **不假装成功**：抓不到就记原因（token 过期 / 已删除 / 不支持），不写半成品。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../lib/store.js';
import { normalize } from '../lib/normalize.js';
import { createIngest, SUPPORTED } from '../lib/ingest.js';
import { createThrottle } from '../lib/throttle.js';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const flag = (n) => argv.includes(n);

const manifestPath = opt('--manifest', '');
if (!manifestPath) {
  console.error('usage: node scripts/import-inread.mjs --manifest <json> [--limit N] [--dry-run] [--sleep ms]');
  process.exit(2);
}

const rows = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const LIMIT = Number(opt('--limit', '0')) || 0;
const DRY = flag('--dry-run');
const SLEEP = Number(opt('--sleep', '1200'));

const store = createStore();
const stamp = new Date().toISOString().slice(0, 10);
const outDir = path.join(store.root, 'import');
fs.mkdirSync(outDir, { recursive: true });
const resultFile = path.join(outDir, `inread-${stamp}.jsonl`);

// 续跑：已经出过结果的 URL 直接跳过
const seen = new Set();
if (fs.existsSync(resultFile)) {
  for (const line of fs.readFileSync(resultFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.url) seen.add(r.url);
    } catch {
      /* 半截行忽略 */
    }
  }
}

const throttle = createThrottle({ file: path.join(store.root, 'state', 'throttle.json') });
const ing = createIngest({ store, throttle });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const append = (obj) => fs.appendFileSync(resultFile, JSON.stringify(obj) + '\n');

const counts = { ok: 0, duplicate: 0, failed: 0, skipped: 0, seen: 0 };
// 只有"被墙"才熔断；老笔记 token 过期是内容问题，连续十条也正常
let wallStreak = 0;
const MAX_WALL_STREAK = 6;
const failReasons = new Map();
const t0 = Date.now();

let processed = 0;
for (const row of rows) {
  if (LIMIT && processed >= LIMIT) break;
  const url = String(row.u || '').trim();
  if (!url) continue;
  if (seen.has(url)) {
    counts.seen += 1;
    continue;
  }
  processed += 1;

  const norm = await normalize(url);
  if (!norm.ok) {
    counts.skipped += 1;
    append({ url, at: new Date().toISOString(), status: 'skipped', reason: norm.error });
    console.log(`⋯ 跳过 ${norm.error} | ${url.slice(0, 54)}`);
    continue;
  }
  if (!SUPPORTED.includes(norm.platform)) {
    counts.skipped += 1;
    append({ url, at: new Date().toISOString(), status: 'skipped', reason: `未接平台 ${norm.platform}` });
    console.log(`⋯ 跳过 未接平台 ${norm.platform} | ${url.slice(0, 54)}`);
    continue;
  }
  if (DRY) {
    counts.ok += 1;
    console.log(`? 可导入 ${norm.platform}/${norm.id} | ${row.t || ''}`.slice(0, 90));
    continue;
  }

  try {
    const res = await ing.ingest(norm);
    if (res.duplicate) {
      counts.duplicate += 1;
      wallStreak = 0;
      append({ url, at: new Date().toISOString(), status: 'duplicate', slug: res.record?.slug });
      console.log(`= 已存在 | ${row.t || norm.id}`);
    } else {
      counts.ok += 1;
      wallStreak = 0;
      append({ url, at: new Date().toISOString(), status: 'ok', slug: res.record?.slug, title: res.record?.title });
      console.log(`✓ ${(res.record?.title || '').slice(0, 34)} | ${(res.record?.assets || []).length} 项素材`);
    }
  } catch (err) {
    counts.failed += 1;
    wallStreak = err?.cooling || err?.throttled ? wallStreak + 1 : 0;
    const reason = String(err?.message || err);
    failReasons.set(reason.slice(0, 40), (failReasons.get(reason.slice(0, 40)) || 0) + 1);
    append({ url, at: new Date().toISOString(), status: 'failed', reason });
    console.log(`✗ ${reason.slice(0, 50)} | ${url.slice(0, 46)}`);
    if (wallStreak >= MAX_WALL_STREAK) {
      console.log(`\n连续 ${wallStreak} 条被判定为拦截页，先停。过一会儿重跑同一条命令即可续跑（已处理的不重复）。`);
      break;
    }
  }

  await sleep(SLEEP);
}

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log('\n──────── 汇总 ────────');
console.log(`处理 ${processed} 条 · 成功 ${counts.ok} · 已存在 ${counts.duplicate} · 失败 ${counts.failed} · 跳过 ${counts.skipped} · 之前已处理 ${counts.seen}`);
console.log(`耗时 ${mins} 分钟 · 结果追加在 ${resultFile}`);
if (failReasons.size) {
  console.log('失败原因：');
  for (const [r, n] of [...failReasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${r}`);
}
