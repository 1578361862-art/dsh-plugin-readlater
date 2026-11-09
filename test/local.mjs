#!/usr/bin/env node
/**
 * 离线自检：不联网，用 .tmp/xhs 里那篇真实笔记当夹具。
 *
 *   node test/local.mjs
 *
 * 干三件事：
 *   1. 归一化：把真实分享链接/分享文案解析成 canonical（不展开短链，那是联网步骤）
 *   2. 渲染：note.json → content.html，落一份到 .tmp/readlater-preview 供肉眼看
 *   3. 自检断言：id、标题、图片数量、相对路径
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickUrl, platformOf, contentIdOf, toHttp } from '../lib/normalize.js';
import { renderNote } from '../lib/render.js';
import { sniffExt } from '../lib/xhs.js';
import { slugOf } from '../lib/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const fixture = process.env.XHS_FIXTURE
  ? path.resolve(process.env.XHS_FIXTURE)
  : path.resolve(repo, '../.tmp/xhs/6aed25de000000000900f771');

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
};

if (!fs.existsSync(path.join(fixture, 'note.json'))) {
  console.error(`找不到夹具：${fixture}`);
  process.exit(2);
}

const note = JSON.parse(fs.readFileSync(path.join(fixture, 'note.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(fixture, 'meta.json'), 'utf8'));

/* ---------- 1. 归一化 ---------- */

const shareText = `56 【${note.title}】 😆 ${note.desc.slice(0, 12)} 😆 http://xhslink.com/a/AbCdEf123，复制本条信息，打开【小红书】App查看精彩内容！`;
const picked = pickUrl(shareText);
check('从分享文案里抽出链接', picked === 'http://xhslink.com/a/AbCdEf123', picked);

const realUrl = meta.sourceUrl;
check('真实分享链接认得出平台', platformOf(realUrl) === 'xhs');
check('真实分享链接取得出 noteId', contentIdOf(realUrl, 'xhs') === note.id, contentIdOf(realUrl, 'xhs'));

const scheme = toHttp(`xhsdiscover://item/${note.id}?xsec_token=abc`);
check('xhsdiscover:// 转 https', scheme.startsWith('https://www.xiaohongshu.com/explore/'), scheme);

check('slug 只含安全字符', /^[a-z0-9-]+$/.test(slugOf('xhs', note.id)), slugOf('xhs', note.id));

/* ---------- 2. 渲染 ---------- */

// 夹具里的图片是按旧脚本命名的（.jpg 其实是 WebP），照真实字节改名，
// 复现修好之后 downloader 会产出的文件名。
const assets = (meta.assets || []).map((a, i) => {
  const src = path.join(fixture, a.file);
  const buf = fs.existsSync(src) ? fs.readFileSync(src) : null;
  const ext = buf ? sniffExt(buf) : null;
  const stem = a.file.replace(/\.[^.]+$/, '');
  return {
    file: ext ? `${stem}${ext}` : a.file,
    srcFile: a.file,
    bytes: a.bytes,
    kind: 'image',
    w: note.images?.[i]?.w || 0,
    h: note.images?.[i]?.h || 0,
  };
});

const rec = {
  id: note.id,
  slug: slugOf('xhs', note.id),
  platform: 'xhs',
  platformLabel: '小红书',
  url: realUrl,
  title: note.title,
  author: note.user?.name || '',
  published: note.time ? new Date(Number(note.time)).toISOString() : null,
  saved: new Date().toISOString(),
  layout: note.video ? 'video' : 'gallery',
  ipLocation: note.ipLocation || '',
  tags: note.tags || [],
  stats: note.interact,
  assets,
};

const html = renderNote(rec);

const outDir = path.resolve(repo, '../.tmp/readlater-preview', rec.slug);
fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'content.html'), html, 'utf8');
for (const a of assets) {
  const src = path.join(fixture, a.srcFile);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, 'assets', a.file));
}

check('渲染出的图片数与夹具一致', (html.match(/<img /g) || []).length === assets.length, `${(html.match(/<img /g) || []).length}/${assets.length}`);
check('图片用的是相对路径', html.includes('src="assets/img-01'));
check('标题进了 <h1>', html.includes(`<h1>${note.title}</h1>`) || html.includes(note.title.slice(0, 10)));
check('标签渲染成 chip', (note.tags || []).every((t) => html.includes(`#${t}`)));
check('没有残留转义的尖括号', !/<p>[^<]*&lt;script/.test(html));

console.log(`\n预览：${outDir}/content.html`);
console.log(`大小：${(html.length / 1024).toFixed(1)} KB HTML · ${assets.length} 张图`);
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
