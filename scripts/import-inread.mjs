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
// 只处理指定平台：风控期间先把不受影响的（公众号）收掉
const ONLY = String(opt('--platform', '')).split(',').map((x) => x.trim()).filter(Boolean);

const store = createStore();
const stamp = new Date().toISOString().slice(0, 10);
const outDir = path.join(store.root, 'import');
fs.mkdirSync(outDir, { recursive: true });
const resultFile = path.join(outDir, `inread-${stamp}.jsonl`);

/**
 * 续跑历史。
 *
 * 关键：**失败不能当成"已处理"**。被风控的那几分钟里刷出来的失败，
 * 如果也标成已处理，这批链接就永久废掉了 —— 这正是第一版踩的坑。
 * 所以按 url 聚合：成功的跳过，失败的最多重试 2 次。
 */
const history = new Map();
// 结果文件按日期分，但历史必须读**全部**——只看当天等于每天从零开始
const histFiles = fs.existsSync(outDir)
  ? fs.readdirSync(outDir).filter((f) => /^inread-.*\.jsonl$/.test(f)).sort()
  : [];
for (const hf of histFiles) {
  for (const line of fs.readFileSync(path.join(outDir, hf), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!r.url) continue;
      const cur = history.get(r.url) || { ok: false, fails: 0, lastReason: '' };
      if (r.status === 'ok' || r.status === 'duplicate' || r.status === 'skipped') cur.ok = true;
      if (r.status === 'failed' && !r.transient) {
        cur.fails += 1;
        cur.lastReason = r.reason || '';
      }
      history.set(r.url, cur);
    } catch {
      /* 半截行忽略 */
    }
  }
}
const MAX_ATTEMPTS = 2;
const shouldSkip = (url) => {
  const h = history.get(url);
  if (!h) return false;
  return h.ok || h.fails >= MAX_ATTEMPTS;
};

// 导入是批量的：间隔等待可以长一点，别把"才过 11 秒"当成中止信号
const throttle = createThrottle({ file: path.join(store.root, 'state', 'throttle.json'), maxWaitMs: 30000 });
// 小红书要慢得多：实测连续 ~30 条就会被踢回发现页
const throttleXhs = createThrottle({
  file: path.join(store.root, 'state', 'throttle-xhs.json'),
  minGapMs: Number(opt('--gap', '6000')),
  baseMs: 10 * 60 * 1000,
  capMs: 60 * 60 * 1000,
});
const ing = createIngest({ store, throttle, throttleXhs });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const append = (obj) => fs.appendFileSync(resultFile, JSON.stringify(obj) + '\n');

if (flag('--status')) {
  let ok = 0;
  let bad = 0;
  let skip = 0;
  for (const [, h] of history) {
    if (h.ok) ok += 1;
    else if (h.fails >= MAX_ATTEMPTS) bad += 1;
    else skip += 1;
  }
  const total = rows.length;
  console.log(`清单 ${total} 条`);
  console.log(`  已导入/已跳过 ${ok}`);
  console.log(`  重试未达上限 ${skip}`);
  console.log(`  已放弃（失败 ${MAX_ATTEMPTS} 次）${bad}`);
  console.log(`  结果文件 ${resultFile}`);
  process.exit(0);
}

const counts = { ok: 0, duplicate: 0, failed: 0, skipped: 0, seen: 0, filtered: 0 };
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
  if (shouldSkip(url)) {
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
  if (ONLY.length && !ONLY.includes(norm.platform)) {
    // 只是"本轮不处理"，不能落盘：落盘就等于把它标成已处理，以后永远不会再试
    counts.filtered = (counts.filtered || 0) + 1;
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
    if (err?.cooling) {
      console.log(`\n⏸ ${err.message}`);
      console.log('   已处理的不重复；过一段时间重跑同一条命令即可续跑。');
      break;
    }
    const reason = String(err?.message || err);
    // 撞墙、CDP 超时这类是环境问题，不该消耗这条链接的重试次数
    const transient = /登录\/验证|冷却|CDP|超时/.test(reason);
    if (!transient) counts.failed += 1;
    else counts.transient = (counts.transient || 0) + 1;
    wallStreak = transient ? wallStreak + 1 : 0;
    failReasons.set(reason.slice(0, 40), (failReasons.get(reason.slice(0, 40)) || 0) + 1);
    append({ url, at: new Date().toISOString(), status: 'failed', reason, transient });
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
console.log(`处理 ${processed} 条 · 过滤 ${counts.filtered || 0} · 成功 ${counts.ok} · 已存在 ${counts.duplicate} · 失败 ${counts.failed} · 跳过 ${counts.skipped} · 之前已处理 ${counts.seen}`);
console.log(`耗时 ${mins} 分钟 · 结果追加在 ${resultFile}`);
if (failReasons.size) {
  console.log('失败原因：');
  for (const [r, n] of [...failReasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${r}`);
}
