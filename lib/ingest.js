/**
 * 抓取 → 落库。
 *
 * 从宿主里抽出来的原因：面板走 /add 要这套，导入脚本（把别处的收藏搬过来）
 * 也要这套。两边各写一份，迟早一边认了新的平台、另一边不认。
 */

import path from 'node:path';
import { slugOf } from './store.js';
import { canonicalUrlOf } from './normalize.js';
import { readNote, saveAssets } from './xhs.js';
import { readArticle as readWechat } from './wechat.js';
import { renderNote } from './render.js';
import { contentHash } from './project.js';

const PLATFORM_LABEL = { xhs: '小红书', wechat: '微信公众号', zhihu: '知乎', douyin: '抖音' };
export const SUPPORTED = ['xhs', 'wechat'];

export const nowIso = () => new Date().toISOString();

/** 任何一步都不许无限等：超时就报错，队列继续往下走。 */
export const withDeadline = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}超时 ${Math.round(ms / 1000)}s`)), ms)),
  ]);

/** 给全文检索用的纯文本；只是索引料，不参与展示。 */
export const plainText = (html, cap = 4000) =>
  String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap);

/**
 * @param {object} deps
 * @param {object} deps.store      createStore() 的实例
 * @param {object} [deps.throttle] 平台刹车（微信）
 * @param {string} [deps.profileDir]
 * @param {(p:{slug:string,step:string}) => void} [deps.progress]
 * @param {(m:string) => void} [deps.log]
 */
export function createIngest({
  store,
  throttle,
  throttleXhs,
  profileDir,
  progress = () => {},
  log = (m) => console.log(`[readlater] ${m}`),
}) {
async function ingestXhs(norm, { refresh = false, video = false } = {}) {
  const slug = slugOf('xhs', norm.id);
  if (!refresh && (await store.has(slug))) {
    return { duplicate: true, record: await store.readMeta(slug) };
  }

  progress({ slug, step: '打开页面' });
  const { note, finalUrl } = await withDeadline(
    readNote(norm.url, {
      profileDir,
      timeoutMs: 30000,
      log: (m) => console.log(`[readlater] ${m}`),
    }),
    180000,
    '小红书解析',
  );

  const dir = store.dirOf(slug);
  progress({ slug, step: '缓存图片' });
  const { assets, failed } = await saveAssets(note, path.join(dir, 'assets'), {
    wantVideo: !!video,
    log: (m) => console.log(`[readlater] ${m}`),
  });

  const layout = note.video ? 'video' : (note.images?.length ? 'gallery' : 'article');
  const mediaBytes = assets.reduce((n, a) => n + (Number(a.bytes) || 0), 0);

  const meta = {
    id: note.id,
    slug,
    platform: 'xhs',
    platformLabel: PLATFORM_LABEL.xhs,
    url: finalUrl || norm.url,
    canonicalUrl: canonicalUrlOf(norm.url, 'xhs', norm.id),
    sourceUrl: norm.url,
    title: note.title || '(无标题)',
    desc: note.desc || '',
    author: note.user?.name || '',
    authorId: note.user?.id || '',
    published: note.time ? new Date(Number(note.time)).toISOString() : null,
    saved: nowIso(),
    updated: nowIso(),
    status: 'unread',
    star: false,
    layout,
    ipLocation: note.ipLocation || '',
    tags: note.tags || [],
    stats: note.interact || null,
    // 摘要文本给以后的全文检索用，不是展示
    text: [note.title, note.desc, (note.tags || []).join(' ')].filter(Boolean).join('\n'),
    assets,
    failedAssets: failed,
    mediaBytes,
    projectedAt: null,
    projectedHash: null,
  };
  meta.contentHash = contentHash(meta);

  progress({ slug, step: '生成阅读视图' });
  await store.save(meta, renderNote(meta));
  return { duplicate: false, record: meta };
}

/** 抓一篇公众号：帖子能直接拿到 HTML，不需要浏览器。 */
async function ingestWechat(norm, { refresh = false } = {}) {
  const slug = slugOf('wechat', norm.id);
  if (!refresh && (await store.has(slug))) {
    return { duplicate: true, record: await store.readMeta(slug) };
  }

  progress({ slug, step: '抓取正文' });
  const dir = store.dirOf(slug);
  const r = await withDeadline(
    readWechat(norm.url, {
      throttle,
      assetsDir: path.join(dir, 'assets'),
      // 刻意不给 profileDir：微信会对复用的浏览器 profile 追加「环境异常，去验证」，
      // 一次性 profile 反而直接放行。见 README「为什么微信不复用 profile」。
      log: (m) => console.log(`[readlater] ${m}`),
    }),
    180000,
    '公众号解析',
  );

  const layout = r.kind === 'gallery' ? 'gallery' : 'article';
  const mediaBytes = (r.assets || []).reduce((n, a) => n + (Number(a.bytes) || 0), 0);
  const bodyHtml = layout === 'article' ? r.bodyHtml : '';

  const meta = {
    id: norm.id,
    slug,
    platform: 'wechat',
    platformLabel: PLATFORM_LABEL.wechat,
    url: r.finalUrl || norm.url,
    canonicalUrl: canonicalUrlOf(norm.url, 'wechat', norm.id),
    sourceUrl: norm.url,
    title: r.title || '(无标题)',
    desc: r.desc || '',
    author: r.author || '',
    siteName: r.siteName || '',
    published: r.published || null,
    saved: nowIso(),
    updated: nowIso(),
    status: 'unread',
    star: false,
    layout,
    hasBody: layout === 'article',
    via: r.via || null,
    tags: [],
    text: [r.title, r.desc, plainText(bodyHtml, 2000)].filter(Boolean).join('\n'),
    assets: r.assets || [],
    failedAssets: r.failed || [],
    mediaBytes,
    projectedAt: null,
    projectedHash: null,
  };
  meta.contentHash = contentHash(meta, bodyHtml);

  progress({ slug, step: '生成阅读视图' });
  await store.save(meta, renderNote(meta, { bodyHtml }), bodyHtml || undefined);
  return { duplicate: false, record: meta };
}

/** 按平台分发。 */
async function ingest(norm, opts = {}) {
  if (norm.platform === 'xhs') return ingestXhs(norm, opts);
  if (norm.platform === 'wechat') return ingestWechat(norm, opts);
  throw new Error(`${PLATFORM_LABEL[norm.platform] || norm.platform} 还没接上`);
}
  return { ingest, ingestXhs, ingestWechat };
}
