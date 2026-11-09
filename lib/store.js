/**
 * 本地库。
 *
 * 布局（每篇一个文件夹，两边的相对路径一致，所以将来"同步到 Obsidian"就是 cp -R）：
 *
 *   ~/Data/readlater/
 *     library/<platform>-<id>/
 *       meta.json        记录与资源清单
 *       content.html     清洗后的正文（唯一真源）
 *       assets/          图片、视频
 *
 * 没有数据库：几百篇的量，readdir + meta.json 足够；等要全文检索再上 SQLite 索引，
 * 那是**派生**出来的东西，删了能重建。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

const SLUG_RE = /^[a-z0-9-]+$/;

export function defaultRoot() {
  return path.join(homedir(), 'Data', 'readlater');
}

export function slugOf(platform, id) {
  return `${platform}-${id}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

export function createStore(root = defaultRoot()) {
  const libraryDir = path.join(root, 'library');

  const dirOf = (slug) => {
    if (!SLUG_RE.test(String(slug || ''))) throw new Error(`非法 id：${slug}`);
    return path.join(libraryDir, slug);
  };

  async function ensure() {
    await fs.mkdir(libraryDir, { recursive: true });
  }

  /**
   * 正文 HTML 另存 body.html：站点原文可能上百 KB，
   * 塞进 meta.json 会让 /list 每次都背着它走。
   */
  async function save(meta, html, bodyHtml) {
    const dir = dirOf(meta.slug);
    await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    if (typeof html === 'string') await fs.writeFile(path.join(dir, 'content.html'), html, 'utf8');
    if (typeof bodyHtml === 'string') await fs.writeFile(path.join(dir, 'body.html'), bodyHtml, 'utf8');
    return meta;
  }

  async function readBody(slug) {
    try {
      return await fs.readFile(path.join(dirOf(slug), 'body.html'), 'utf8');
    } catch {
      return null;
    }
  }

  async function readMeta(slug) {
    const raw = await fs.readFile(path.join(dirOf(slug), 'meta.json'), 'utf8');
    return JSON.parse(raw);
  }

  async function readHtml(slug) {
    return fs.readFile(path.join(dirOf(slug), 'content.html'), 'utf8');
  }

  async function has(slug) {
    try {
      await fs.access(path.join(dirOf(slug), 'meta.json'));
      return true;
    } catch {
      return false;
    }
  }

  async function list() {
    await ensure();
    let names = [];
    try {
      names = await fs.readdir(libraryDir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      if (!SLUG_RE.test(name)) continue; // .DS_Store 之类
      try {
        out.push(await readMeta(name));
      } catch {
        /* 半截目录（写到一半崩了）跳过，不要让一条坏数据毁掉整个列表 */
      }
    }
    out.sort((a, b) => String(b.saved || '').localeCompare(String(a.saved || '')));
    return out;
  }

  async function remove(slug) {
    await fs.rm(dirOf(slug), { recursive: true, force: true });
  }

  async function assetPath(slug, file) {
    // 双保险：slug 与文件名都只允许安全字符，杜绝 ../ 逃逸
    if (!SLUG_RE.test(String(slug || ''))) throw new Error('非法 id');
    if (!/^[\w.-]+$/.test(String(file || ''))) throw new Error('非法文件名');
    return path.join(dirOf(slug), 'assets', file);
  }

  async function stats() {
    const items = await list();
    const bytes = items.reduce((n, m) => n + (Number(m.mediaBytes) || 0), 0);
    return {
      root,
      count: items.length,
      mediaBytes: bytes,
      projected: items.filter((m) => m.projectedAt).length,
      byPlatform: items.reduce((acc, m) => {
        acc[m.platform] = (acc[m.platform] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  return { root, libraryDir, ensure, save, readMeta, readHtml, readBody, has, list, remove, assetPath, stats, dirOf };
}
