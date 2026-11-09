#!/usr/bin/env node
/**
 * 限流刹车单测：用可注入的时钟，不真的等两分钟。
 *
 *   node test/throttle.mjs
 *
 * 验的是"别把封禁撞深"这条策略：请求间隔、指数冷却、冷却期快速失败、成功后清零、状态落盘。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createThrottle, formatDuration } from '../lib/throttle.js';

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
};

const clock = { t: 1_000_000, now() { return this.t; }, advance(ms) { this.t += ms; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-thr-'));
const file = path.join(tmp, 'state', 'throttle.json');

const mk = (over = {}) => createThrottle({ file, now: () => clock.now(), ...over });

/* ---------- 正常放行 ---------- */
const a = mk();
await a.gate();
check('空闲时放行', a.peek().lastAttemptAt === clock.now());
check('放行后不冷却', a.status().cooling === false);

/* ---------- 间隔太近：快速失败 ---------- */
let err = null;
try {
  await a.gate();
} catch (e) {
  err = e;
}
check('间隔太近直接拒绝', !!err && err.cooling === true);
check('拒绝信息里有可读时长', /秒|分钟/.test(String(err?.message || '')), String(err?.message || '').slice(0, 40));

clock.advance(16_000);
err = null;
try {
  await a.gate();
} catch (e) {
  err = e;
}
check('等够间隔后放行', err === null);

/* ---------- 擦墙：指数冷却 ---------- */
const first = await a.onThrottle('环境异常');
check('第一次撞墙冷却 2 分钟', first.wait === 120_000, String(first.wait));
check('冷却中 status 正确', a.status().cooling === true);
check('冷却倒计时可读', a.status().remainsText.length > 0, a.status().remainsText);

err = null;
try {
  await a.gate();
} catch (e) {
  err = e;
}
check('冷却期不再发请求', !!err && err.cooling === true && /冷却/.test(err.message), String(err?.message || '').slice(0, 30));

const second = await a.onThrottle();
check('第二次冷却翻倍到 4 分钟', second.wait === 240_000, String(second.wait));
check('strikes 累计', second.strikes === 2, String(second.strikes));

for (let i = 0; i < 8; i += 1) await a.onThrottle();
const capped = a.peek();
check('冷却有上限（30 分钟）', a.status().cooldownUntil - clock.now() <= 30 * 60 * 1000, String(a.status().cooldownUntil - clock.now()));

/* ---------- 成功清零 ---------- */
await a.onSuccess();
check('成功后冷却清零', a.status().cooling === false && a.peek().strikes === 0);

/* ---------- 落盘：新实例能读到 ---------- */
const b = mk();
await b.load();
const c = mk();
await c.onThrottle('环境异常');
const d = mk();
await d.load();
check('冷却状态跨实例保留', d.status().cooling === true);

/* ---------- 可读时长 ---------- */
check('90 秒格式化', formatDuration(90_000) === '1 分 30 秒', formatDuration(90_000));
check('整分钟格式化', formatDuration(120_000) === '2 分钟', formatDuration(120_000));
check('不足一分钟', formatDuration(45_000) === '45 秒', formatDuration(45_000));

/* ---------- 等待路径（间隔小于上限时会真的等） ---------- */
// 换一个状态文件：上一个实例还在冷却，共用文件会直接被拦住
const quick = createThrottle({
  file: path.join(tmp, 'state', 'quick.json'),
  now: () => clock.now(),
  minGapMs: 40,
  maxWaitMs: 1000,
  baseMs: 1000,
});
await quick.gate();
const t0 = Date.now();
await quick.gate();
check('间隔小于上限时会等待而不是报错', Date.now() - t0 >= 30, `${Date.now() - t0}ms`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
