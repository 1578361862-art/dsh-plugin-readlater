/**
 * 平台级的"别撞墙"刹车。
 *
 * 微信对频率极敏感：连续请求几次就会进「环境异常」验证页，而且越撞冷却越久。
 * 所以这里不是"失败了重试三次"，而是三件更保守的事：
 *
 *   1. **请求间隔**：两次公众号抓取之间至少隔 15 秒，压住触发概率；
 *   2. **指数冷却**：撞一次验证 → 冷却 2 分钟，再撞 → 4、8…最多 30 分钟；
 *   3. **冷却期快速失败**：直接报"还剩几分几秒"，不再发请求，避免把封锁撞深。
 *
 * 状态落盘（`<root>/state/throttle.json`），重启不会立刻又去撞一次。
 * 时钟与存储都可注入，便于单测。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULTS = {
  minGapMs: 15000, // 两次请求之间的最小间隔
  baseMs: 120000, // 第一次撞墙的冷却时长
  capMs: 30 * 60 * 1000, // 冷却上限
  maxWaitMs: 10000, // gate() 最多愿意等多久；超过就快速失败
};

const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} 分 ${rest} 秒` : `${m} 分钟`;
};

export function createThrottle({ file, label = '微信', now = () => Date.now(), ...opts } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  let state = { cooldownUntil: 0, strikes: 0, lastAttemptAt: 0, lastReason: '' };
  let loaded = false;

  async function load() {
    if (loaded) return;
    loaded = true;
    if (!file) return;
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      state = { ...state, ...raw };
    } catch {
      /* 没有状态文件就是干净的 */
    }
  }

  async function save() {
    if (!file) return;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf8');
    } catch {
      /* 落盘失败不该让解析失败 */
    }
  }

  function status() {
    const t = now();
    const remains = Math.max(0, state.cooldownUntil - t);
    return {
      cooling: remains > 0,
      remainsMs: remains,
      remainsText: remains > 0 ? fmt(remains) : '',
      strikes: state.strikes,
      cooldownUntil: state.cooldownUntil || null,
    };
  }

  /** 发请求前的闸门：冷却中直接抛错；离上次太近则等一小会儿。 */
  async function gate() {
    await load();
    const t = now();

    const cooling = state.cooldownUntil - t;
    if (cooling > 0) {
      const err = new Error(`${label}还在冷却（约 ${fmt(cooling)}后重试）。连续请求会被判为环境异常，越撞越久。`);
      err.cooling = true;
      throw err;
    }

    const gap = state.lastAttemptAt + cfg.minGapMs - t;
    if (gap > 0) {
      if (gap > cfg.maxWaitMs) {
        const err = new Error(`上一个${label}请求才过 ${fmt(cfg.minGapMs - gap)}，隔 ${fmt(gap)} 再来（对频率敏感）。`);
        err.cooling = true;
        throw err;
      }
      await new Promise((r) => setTimeout(r, gap));
    }

    state.lastAttemptAt = now();
    await save();
  }

  /** 成功：把惩罚清零。 */
  async function onSuccess() {
    state.strikes = 0;
    state.cooldownUntil = 0;
    state.lastReason = '';
    await save();
  }

  /** 撞墙：升级冷却。返回本次冷却时长。 */
  async function onThrottle(reason = '环境异常') {
    state.strikes = Math.min(state.strikes + 1, 10);
    const wait = Math.min(cfg.baseMs * 2 ** (state.strikes - 1), cfg.capMs);
    state.cooldownUntil = now() + wait;
    state.lastReason = String(reason);
    await save();
    return { wait, strikes: state.strikes };
  }

  /** 测试用：直接读内部状态。 */
  const peek = () => ({ ...state });

  return { gate, onSuccess, onThrottle, status, load, peek, fmt };
}

export { fmt as formatDuration };
