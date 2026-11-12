/**
 * 面板设置。存在 ~/Data/readlater/settings.json，是所有可调项的单一来源。
 *
 * 只放"改了立刻有感觉"的几项：
 *   video   新收藏默认是否连视频一起存（体积大，默认开）
 *   vault   Obsidian 目标库的根目录（空 = 用探测到的默认库）
 *
 * 数据目录不在这里改：换库等于换一套历史，需要搬迁，不是一次点击能完成的事，
 * 面板上只展示 + 打开。
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveVault as detectVault, SUBDIR } from './project.js';

// 和 store 用同一个根：READLATER_ROOT 可把整块数据（含设置）挪到别处，测试才不会污染真配置
export const DATA_DIR = process.env.READLATER_ROOT || path.join(os.homedir(), 'Data', 'readlater');
export const SETTINGS_FILE = process.env.READLATER_SETTINGS || path.join(DATA_DIR, 'settings.json');

const DEFAULTS = { video: true, vault: '' };

async function readRaw() {
  try {
    return JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** 读设置，并把"空字符串"归一成探测到的默认值。 */
export async function readSettings() {
  const raw = await readRaw();
  const detected = await detectVault();
  return {
    video: raw.video === undefined ? DEFAULTS.video : !!raw.video,
    vault: raw.vault || detected,
    vaultIsDefault: !raw.vault,
    vaultDetected: detected,
    subdir: SUBDIR,
    dataDir: DATA_DIR,
  };
}

/** 合并写入。只认已知键，其余丢弃。 */
export async function writeSettings(patch = {}) {
  const raw = await readRaw();
  const next = { ...DEFAULTS, ...raw };

  if (patch.video !== undefined) next.video = !!patch.video;
  if (patch.vault !== undefined) {
    const v = String(patch.vault || '').trim();
    if (v) {
      // 允许写不存在的目录，但不能是相对路径
      if (!v.startsWith('/')) throw new Error('vault 路径要以 / 开头');
      next.vault = v;
    } else {
      delete next.vault; // 清空 = 回到探测默认
    }
  }

  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return readSettings();
}
