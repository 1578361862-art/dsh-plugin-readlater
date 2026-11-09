/**
 * Obsidian 单向投影。
 *
 * 目标目录：<vault>/90.同步/ReadLater/
 *   managed_by: "readlater" / managed: true 写在每个文件头上，
 *   和 90.同步/BookTutor 同一套约定 —— 这块目录是生成的，不要手改。
 *
 * 版面：
 *   阅读索引.md                     全部已投影条目的链接列表
 *   <标题>--<id8>.md                一篇一个文件
 *   assets/<id8>/img-01.webp        正文图片，按条目分目录
 *
 * 为什么用 `--<id8>` 后缀：标题会改，id 不会。投影时先按 id 找旧文件再改写，
 * 改标题不会在 vault 里留下两个同名条目。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export const SUBDIR = '90.同步/ReadLater';
const DEFAULT_VAULT = path.join(
  os.homedir(),
  'Library/Mobile Documents/iCloud~md~obsidian/Documents/Obs_Yee',
);

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
});
td.use(gfm);
// 图片在 vault 里是本地相对路径，不要被转义
td.addRule('image', {
  filter: 'img',
  replacement: (_content, node) => {
    const src = node.getAttribute('src') || '';
    if (!src) return '';
    const alt = node.getAttribute('alt') || '';
    return `\n\n![${alt}](${src})\n\n`;
  },
});
// 表格里的 tbody 会让 GFM 插件放弃转换，先脱掉
td.addRule('table', {
  filter: 'table',
  replacement: (content) => `\n\n${content.trim()}\n\n`,
});

/** vault 根目录：环境变量 > 配置文件 > 默认 iCloud 路径。 */
export async function resolveVault() {
  if (process.env.READLATER_VAULT) return process.env.READLATER_VAULT;
  const cfgFile = path.join(os.homedir(), 'Data/readlater/config.json');
  try {
    const cfg = JSON.parse(await fs.readFile(cfgFile, 'utf8'));
    if (cfg.vault) return cfg.vault;
  } catch {
    /* 没配置就用默认 */
  }
  return DEFAULT_VAULT;
}

export function shortId(slug) {
  return createHash('sha1').update(String(slug)).digest('hex').slice(0, 8);
}

/** 文件名安全化：去掉路径分隔符与控制字符，限长。 */
export function safeTitle(title) {
  const s = String(title || '无标题')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (s || '无标题').slice(0, 80);
}

export const fileNameOf = (meta) => `${safeTitle(meta.title)}--${shortId(meta.slug)}.md`;

const yamlStr = (v) => JSON.stringify(String(v ?? ''));

/** 正文变了没有：投影时存一份，之后拿它和 contentHash 比。 */
export function contentHash(meta, bodyHtml = '') {
  const h = createHash('sha1');
  h.update(String(meta.title || ''));
  h.update('\u0000');
  h.update(String(meta.desc || ''));
  h.update('\u0000');
  h.update((meta.tags || []).join('\u0001'));
  h.update('\u0000');
  h.update(String(bodyHtml || ''));
  for (const a of meta.assets || []) h.update(`\u0000${a.file || ''}:${a.bytes || 0}`);
  return h.digest('hex').slice(0, 16);
}

/** 正文 HTML → Markdown，图片链接指向 vault 里的 assets/<id8>/。 */
export function bodyToMarkdown(html, id8) {
  const localized = String(html || '')
    .replace(/(src|href)="assets\//g, `$1="assets/${id8}/`)
    .replace(/<tbody>/gi, '')
    .replace(/<\/tbody>/gi, '');
  return td.turndown(localized).trim();
}

function frontmatter(meta, id8) {
  const tags = (meta.tags || []).map((t) => `  - ${yamlStr(t)}`).join('\n');
  const lines = [
    '---',
    'managed_by: "readlater"',
    'managed: true',
    `readlater_id: ${yamlStr(meta.slug)}`,
    `source: ${yamlStr(meta.platformLabel || meta.platform || '')}`,
    // 写干净地址：分享链接里的 token 是一次性凭证，不该留在笔记里
    `url: ${yamlStr(meta.canonicalUrl || meta.url || '')}`,
    `author: ${yamlStr(meta.author || '')}`,
    meta.published ? `published: ${yamlStr(String(meta.published).slice(0, 10))}` : 'published: null',
    `saved: ${yamlStr(String(meta.saved || '').slice(0, 10))}`,
    `status: ${yamlStr(meta.status || 'unread')}`,
    `layout: ${yamlStr(meta.layout || 'article')}`,
    `asset_dir: ${yamlStr(`assets/${id8}`)}`,
  ];
  if (tags) {
    lines.push('tags:');
    lines.push(tags);
  } else {
    lines.push('tags: []');
  }
  lines.push('---', '');
  return lines.join('\n');
}

/** 一篇笔记的完整 Markdown。 */
export function renderNote(meta, bodyHtml = '', id8 = shortId(meta.slug)) {
  const head = [
    frontmatter(meta, id8),
    `# ${meta.title || '无标题'}`,
    '',
    meta.author ? `- 作者：${meta.author}` : null,
    meta.platformLabel ? `- 来源：${meta.platformLabel}` : null,
    `- 原文：${meta.canonicalUrl || meta.url || ''}`,
    `- 保存：${String(meta.saved || '').slice(0, 10)}`,
    '',
  ].filter((x) => x !== null);

  const parts = [...head];

  if (meta.layout === 'article' && bodyHtml) {
    parts.push('## 正文', '', bodyToMarkdown(bodyHtml, id8), '');
  } else {
    if (meta.desc) parts.push(String(meta.desc).trim(), '');
    const images = (meta.assets || []).filter((a) => a.kind === 'image' && a.file);
    if (images.length) {
      parts.push('## 图片', '');
      for (const a of images) parts.push(`![](assets/${id8}/${a.file})`, '');
    }
    if (meta.tags?.length) parts.push(meta.tags.map((t) => `#${t}`).join(' '), '');
  }

  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** 索引笔记：一行一条，链接用 wikilink（与 BookTutor 的 书库索引 同构）。 */
export function renderIndex(items) {
  const lines = [
    '---',
    'managed_by: "readlater"',
    'managed: true',
    '---',
    '',
    '# 阅读索引',
    '',
    `共 ${items.length} 篇。`,
    '',
  ];
  for (const it of items) {
    const base = fileNameOf(it).replace(/\.md$/, '');
    const bits = [it.author, it.platformLabel, String(it.projectedAt || it.saved || '').slice(0, 10)].filter(Boolean);
    lines.push(`- [[${base}|${it.title || '无标题'}]]${bits.length ? ` — ${bits.join(' · ')}` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

const exists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * 投影一篇。幂等：同一条目重复投影只会覆盖，不会产生第二个文件。
 * @returns {Promise<{file:string, mdChars:number, images:number, renamedFrom?:string}>}
 */
export async function project(meta, bodyHtml, { vaultRoot, libraryDir } = {}) {
  const root = vaultRoot || (await resolveVault());
  const dir = path.join(root, SUBDIR);
  if (!(await exists(root))) throw new Error(`找不到 Obsidian vault：${root}`);
  await fs.mkdir(dir, { recursive: true });

  const id8 = shortId(meta.slug);
  const md = renderNote(meta, bodyHtml, id8);
  const target = path.join(dir, fileNameOf(meta));

  // 同 id 但标题变了的旧文件要清掉，否则会留下两个条目
  let renamedFrom;
  const entries = await fs.readdir(dir);
  for (const name of entries) {
    if (!name.endsWith(`--${id8}.md`)) continue;
    if (name === path.basename(target)) continue;
    await fs.rm(path.join(dir, name), { force: true });
    renamedFrom = name;
  }

  // 素材：拷到 assets/<id8>/，正文里的链接已按这个路径重写
  const srcAssets = path.join(libraryDir, meta.slug, 'assets');
  const dstAssets = path.join(dir, 'assets', id8);
  let images = 0;
  if (await exists(srcAssets)) {
    await fs.mkdir(dstAssets, { recursive: true });
    for (const f of await fs.readdir(srcAssets)) {
      if (f.startsWith('.')) continue;
      await fs.copyFile(path.join(srcAssets, f), path.join(dstAssets, f));
      images += 1;
    }
  }

  await fs.writeFile(target, md, 'utf8');
  return { file: target, mdChars: md.length, images, renamedFrom };
}

/** 撤销投影：删笔记与素材目录。索引由调用方重建。 */
export async function unproject(meta, { vaultRoot } = {}) {
  const root = vaultRoot || (await resolveVault());
  const dir = path.join(root, SUBDIR);
  const id8 = shortId(meta.slug);
  let removed = 0;
  try {
    for (const name of await fs.readdir(dir)) {
      if (name.endsWith(`--${id8}.md`)) {
        await fs.rm(path.join(dir, name), { force: true });
        removed += 1;
      }
    }
  } catch {
    /* 目录不存在就等于没投影过 */
  }
  await fs.rm(path.join(dir, 'assets', id8), { recursive: true, force: true });
  return { removed };
}

/** 重写索引笔记。 */
export async function writeIndex(items, { vaultRoot } = {}) {
  const root = vaultRoot || (await resolveVault());
  const dir = path.join(root, SUBDIR);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, '阅读索引.md');
  await fs.writeFile(file, renderIndex(items), 'utf8');
  return { file, count: items.length };
}
