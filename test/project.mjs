#!/usr/bin/env node
/**
 * Obsidian 投影自检：全离线，用临时 vault。
 *
 *   node test/project.mjs
 *
 * 验四件事：版面（frontmatter / 图片路径）、幂等（重复投影不产生第二个文件）、
 * 改标题不残留旧文件、撤销干净。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  project, unproject, writeIndex, renderIndex, shortId, safeTitle, fileNameOf, bodyToMarkdown,
} from '../lib/project.js';

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-proj-'));
const vaultRoot = path.join(tmp, 'vault');
const libraryDir = path.join(tmp, 'library');
const slug = 'xhs-6af199360000000036013aea';
const id8 = shortId(slug);

fs.mkdirSync(vaultRoot, { recursive: true });
fs.mkdirSync(path.join(libraryDir, slug, 'assets'), { recursive: true });
fs.writeFileSync(path.join(libraryDir, slug, 'assets', 'img-01.webp'), Buffer.from('RIFFxxxxWEBP'));
fs.writeFileSync(path.join(libraryDir, slug, 'assets', 'img-02.webp'), Buffer.from('RIFFxxxxWEBP'));

const meta = {
  slug, id: '6af199360000000036013aea', platform: 'xhs', platformLabel: '小红书',
  title: 'STUDIYO 用大字和插画做学习APP',
  desc: '第一段。\n\n第二段。',
  author: 'Ul设计师-Troy',
  url: 'https://www.xiaohongshu.com/explore/xxx',
  published: '2026-11-09T00:00:00.000Z',
  saved: '2026-11-09T10:00:00.000Z',
  status: 'unread', layout: 'gallery', tags: ['APP界面设计', '学习APP'],
  assets: [
    { file: 'img-01.webp', kind: 'image', bytes: 12 },
    { file: 'img-02.webp', kind: 'image', bytes: 12 },
  ],
};

/* ---------- 首次投影 ---------- */
const r1 = await project(meta, '', { vaultRoot, libraryDir });
const dir = path.join(vaultRoot, '90.同步/ReadLater');
const md = fs.readFileSync(r1.file, 'utf8');

check('文件写在 90.同步/ReadLater', r1.file.startsWith(dir), path.basename(r1.file));
check('文件名带 id8 后缀', path.basename(r1.file) === `${safeTitle(meta.title)}--${id8}.md`, path.basename(r1.file));
check('frontmatter 有 managed 标记', md.includes('managed_by: "readlater"') && md.includes('managed: true'));
check('frontmatter 有 readlater_id', md.includes(`readlater_id: "${slug}"`));
check('正文段落保留', md.includes('第一段。') && md.includes('第二段。'));
check('图片路径指向 assets/<id8>/', md.includes(`assets/${id8}/img-01.webp`));
check('图片文件已拷进 vault', fs.existsSync(path.join(dir, 'assets', id8, 'img-01.webp')));
check('拷贝了 2 张图', r1.images === 2, String(r1.images));
check('标题是一级标题', md.includes(`# ${meta.title}`));

/* ---------- 幂等 ---------- */
const r2 = await project(meta, '', { vaultRoot, libraryDir });
const mds = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
check('重复投影不产生第二个文件', mds.length === 1, mds.join(','));
check('重复投影不报改名', !r2.renamedFrom);

/* ---------- 改标题 ---------- */
const renamed = { ...meta, title: '换了个标题' };
const r3 = await project(renamed, '', { vaultRoot, libraryDir });
const after = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
check('改标题后只剩一个新文件', after.length === 1 && after[0] === fileNameOf(renamed), after.join(','));
check('记录了旧文件名', r3.renamedFrom === path.basename(r1.file), String(r3.renamedFrom));

/* ---------- 索引 ---------- */
const idx = await writeIndex([{ ...renamed, projectedAt: '2026-11-09T10:00:00.000Z' }], { vaultRoot });
const idxText = fs.readFileSync(idx.file, 'utf8');
check('索引笔记生成', fs.existsSync(idx.file));
check('索引有 managed 头', idxText.includes('managed_by: "readlater"'));
check('索引是 wikilink', idxText.includes(`[[${fileNameOf(renamed).replace(/\.md$/, '')}|换了个标题]]`));
check('索引条数正确', idxText.includes('共 1 篇。'));

/* ---------- 撤销 ---------- */
const u = await unproject(renamed, { vaultRoot });
// 目录里还有 阅读索引.md，只应该剩它
const left = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
check('撤销删掉笔记', !left.some((f) => f.endsWith(`--${id8}.md`)), left.join(','));
check('索引笔记还在', left.includes('阅读索引.md'));
check('撤销删掉素材目录', !fs.existsSync(path.join(dir, 'assets', id8)));

/* ---------- 转换 ---------- */
const tb = bodyToMarkdown('<h2>小节</h2><p>文字<img src="assets/img-01.webp"></p>', id8);
check('HTML 转 Markdown 保留标题', tb.includes('## 小节'), JSON.stringify(tb.slice(0, 40)));
check('转换后图片路径已重写', tb.includes(`assets/${id8}/img-01.webp`));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
