/**
 * 稍后阅读 — 宿主半侧。
 *
 * 浏览器做不了的事都在这里：
 *   - 展开分享短链、认平台（CORS 挡着浏览器）
 *   - 开无头 Chrome 读小红书笔记（需要真实浏览器环境）
 *   - 把图片视频抓到 ~/Data/readlater
 *   - 提供 /view 与 /asset 两个同源路由，给面板里的 iframe 用
 *
 * 浏览器半侧在 lib/client.js，只通过 /readlater/api/* 访问这里。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createStore, slugOf, defaultRoot } from './store.js';
import { normalize, canonicalUrlOf } from './normalize.js';
import { readNote, saveAssets } from './xhs.js';
import { readArticle as readWechat } from './wechat.js';
import { project, unproject, writeIndex, resolveVault, contentHash, shortId, fileNameOf } from './project.js';
import { createThrottle } from './throttle.js';
import { renderNote } from './render.js';

/** Cordis 插件名。 */
export const name = 'readlater';

/** 需要 Web 服务器的具名路由表。 */
export const inject = ['webServer'];

const PREFIX = '/readlater/api';
const PLATFORM_LABEL = { xhs: '小红书', wechat: '微信公众号', zhihu: '知乎', douyin: '抖音' };
const SUPPORTED = ['xhs', 'wechat'];
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4a': 'audio/mp4',
};

const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const nowIso = () => new Date().toISOString();

/** 任何一步都不许无限等：超时就报错，队列继续往下走。 */
const withDeadline = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}超时 ${Math.round(ms / 1000)}s`)), ms)),
  ]);

/** 给全文检索用的纯文本；只是索引料，不参与展示。 */
const plainText = (html, cap = 4000) =>
  String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap);

export function apply(ctx) {
  const store = createStore(process.env.READLATER_ROOT || defaultRoot());
  const profileDir = path.join(store.root, 'profile');
  // 平台级刹车：微信的冷却状态落盘在数据目录里，重启不清零
  const throttle = createThrottle({ file: path.join(store.root, 'state', 'throttle.json') });

  /** 串行队列：同时只跑一个链接，状态给面板轮询。 */
  const queue = { pending: 0, busy: false, current: null, lastError: null };
  let chain = Promise.resolve();

  const enqueue = (fn) => {
    queue.pending += 1;
    const run = chain.then(async () => {
      queue.pending -= 1;
      queue.busy = true;
      try {
        return await fn();
      } finally {
        queue.busy = false;
        queue.current = null;
      }
    });
    // 队列不能因为一条失败就断掉
    chain = run.catch(() => {});
    return run;
  };

  /** 抓一篇小红书：解析 → 落资产 → 渲染 → 存盘。 */
  async function ingestXhs(norm, { refresh = false, video = false } = {}) {
    const slug = slugOf('xhs', norm.id);
    if (!refresh && (await store.has(slug))) {
      return { duplicate: true, record: await store.readMeta(slug) };
    }

    queue.current = { slug, step: '打开页面' };
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
    queue.current = { slug, step: '缓存图片' };
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

    queue.current = { slug, step: '生成阅读视图' };
    await store.save(meta, renderNote(meta));
    return { duplicate: false, record: meta };
  }

  /** 抓一篇公众号：帖子能直接拿到 HTML，不需要浏览器。 */
  async function ingestWechat(norm, { refresh = false } = {}) {
    const slug = slugOf('wechat', norm.id);
    if (!refresh && (await store.has(slug))) {
      return { duplicate: true, record: await store.readMeta(slug) };
    }

    queue.current = { slug, step: '抓取正文' };
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

    queue.current = { slug, step: '生成阅读视图' };
    await store.save(meta, renderNote(meta, { bodyHtml }), bodyHtml || undefined);
    return { duplicate: false, record: meta };
  }

  /** 按平台分发。 */
  async function ingest(norm, opts = {}) {
    if (norm.platform === 'xhs') return ingestXhs(norm, opts);
    if (norm.platform === 'wechat') return ingestWechat(norm, opts);
    throw new Error(`${PLATFORM_LABEL[norm.platform] || norm.platform} 还没接上`);
  }

  /** 把一篇投到 vault，并把投影信息写回 meta。 */
  async function projectOne(slug) {
    const meta = await store.readMeta(slug);
    const body = meta.hasBody ? (await store.readBody(slug)) || '' : '';
    const r = await project(meta, body, { libraryDir: store.libraryDir });
    const next = {
      ...meta,
      projectedAt: nowIso(),
      projectedHash: meta.contentHash || contentHash(meta, body),
    };
    await store.save(next);
    return { ...r, record: next };
  }

  /** 索引始终按"当前所有已投影条目"重建，不维护增量。 */
  async function rebuildIndex() {
    const items = (await store.list())
      .filter((m) => m.projectedAt)
      .sort((a, b) => String(b.projectedAt).localeCompare(String(a.projectedAt)));
    return writeIndex(items);
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname.slice(PREFIX.length);

    try {
      /* ---------- 状态 ---------- */
      if (route === '/state' && req.method === 'GET') {
        return send(res, 200, { ok: true, ...(await store.stats()), queue, throttle: throttle.status() });
      }

      /* ---------- 列表 ---------- */
      if (route === '/list' && req.method === 'GET') {
        const items = await store.list();
        return send(res, 200, {
          ok: true,
          items: items.map((m) => ({
            slug: m.slug, platform: m.platform, platformLabel: m.platformLabel,
            title: m.title, author: m.author, saved: m.saved, published: m.published,
            layout: m.layout, tags: m.tags, status: m.status, star: m.star,
            mediaBytes: m.mediaBytes, assetCount: (m.assets || []).length,
            projectedAt: m.projectedAt || null,
            projectedHash: m.projectedHash || null,
            contentHash: m.contentHash || null,
            hasBody: !!m.hasBody,
            siteName: m.siteName || '',
            // 摘要只给搜索用：两百字，几百条也才几十 KB
            snippet: String(m.text || '').slice(0, 200),
            thumb: (m.assets || []).find((a) => a.kind === 'image' && a.file)?.file || null,
          })),
          queue,
        });
      }

      /* ---------- 新增 ---------- */
      if (route === '/add' && req.method === 'POST') {
        const body = await readJson(req);
        const text = String(body.text || '').trim();
        if (!text) return send(res, 400, { ok: false, error: '先粘贴一条链接' });

        const norm = await normalize(text);
        if (!norm.ok) {
          return send(res, 400, {
            ok: false,
            error: norm.error,
            platform: norm.platform,
            url: norm.url,
            hops: norm.hops,
          });
        }
        if (!SUPPORTED.includes(norm.platform)) {
          return send(res, 400, {
            ok: false,
            error: `${PLATFORM_LABEL[norm.platform] || norm.platform} 还没接上，当前支持小红书、微信公众号`,
            platform: norm.platform,
          });
        }

        const result = await enqueue(() => ingest(norm, { video: !!body.video }));
        return send(res, 200, { ok: true, ...result, normalized: { url: norm.url } });
      }

      /* ---------- 重新解析 ---------- */
      if (route === '/refresh' && req.method === 'POST') {
        const body = await readJson(req);
        const old = await store.readMeta(String(body.slug || ''));
        const norm = await normalize(old.sourceUrl || old.url);
        if (!norm.ok) return send(res, 400, { ok: false, error: norm.error || '无法重新解析' });
        if (!SUPPORTED.includes(norm.platform)) {
          return send(res, 400, { ok: false, error: `${PLATFORM_LABEL[norm.platform] || norm.platform} 还没接上` });
        }
        const result = await enqueue(() => ingest(norm, { refresh: true, video: !!body.video }));
        return send(res, 200, { ok: true, ...result });
      }

      /* ---------- Obsidian 投影 ---------- */
      if (route === '/vault' && req.method === 'GET') {
        const vault = await resolveVault();
        let ok = false;
        try {
          await fs.access(vault);
          ok = true;
        } catch {
          /* 路径不存在 */
        }
        return send(res, 200, { ok, vault, subdir: '90.同步/ReadLater' });
      }

      if (route === '/project' && req.method === 'POST') {
        const body = await readJson(req);
        const r = await projectOne(String(body.slug || ''));
        const index = await rebuildIndex();
        return send(res, 200, { ok: true, ...r, index });
      }

      if (route === '/project-batch' && req.method === 'POST') {
        const body = await readJson(req);
        const every = await store.list();
        const wanted = Array.isArray(body.slugs) ? body.slugs : [];
        // 显式点名就按点名来（已同步的也能重投）；没点名才默认"所有未同步的"
        const targets = wanted.length
          ? every.filter((m) => wanted.includes(m.slug))
          : every.filter((m) => !m.projectedAt);
        const done = [];
        const failed = [];
        for (const m of targets) {
          try {
            const r = await projectOne(m.slug);
            done.push({ slug: m.slug, file: r.file });
          } catch (err) {
            failed.push({ slug: m.slug, error: String(err?.message || err) });
          }
        }
        const index = await rebuildIndex();
        return send(res, 200, { ok: true, done, failed, index });
      }

      if (route === '/unproject' && req.method === 'POST') {
        const body = await readJson(req);
        const meta = await store.readMeta(String(body.slug || ''));
        const r = await unproject(meta);
        const next = { ...meta, projectedAt: null, projectedHash: null };
        await store.save(next);
        const index = await rebuildIndex();
        return send(res, 200, { ok: true, ...r, index });
      }

      /* ---------- 详情 ---------- */
      if (route === '/item' && req.method === 'GET') {
        const meta = await store.readMeta(String(url.searchParams.get('slug') || ''));
        return send(res, 200, { ok: true, record: meta });
      }

      /* ---------- 删除 ---------- */
      if (route === '/delete' && req.method === 'POST') {
        const body = await readJson(req);
        await store.remove(String(body.slug || ''));
        return send(res, 200, { ok: true });
      }

      /* ---------- 阅读视图（给 iframe） ---------- */
      if (route.startsWith('/view/') && req.method === 'GET') {
        const slug = decodeURIComponent(route.slice('/view/'.length));
        const html = await store.readHtml(slug);
        // 存盘时是相对路径（可迁移），对外服务时换成同源绝对路径
        const served = html
          .replace(/(src|poster|href)="assets\//g, `$1="${PREFIX}/asset/${encodeURIComponent(slug)}/`)
          .replace(/(src|poster|href)='assets\//g, `$1='${PREFIX}/asset/${encodeURIComponent(slug)}/`);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy':
            "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
          'cache-control': 'no-store',
        });
        return res.end(served);
      }

      /* ---------- 资产 ---------- */
      if (route.startsWith('/asset/') && req.method === 'GET') {
        const rest = route.slice('/asset/'.length);
        const slash = rest.indexOf('/');
        if (slash < 0) return send(res, 400, { ok: false, error: '缺少文件名' });
        const slug = decodeURIComponent(rest.slice(0, slash));
        const file = decodeURIComponent(rest.slice(slash + 1));
        let p;
        try {
          p = await store.assetPath(slug, file);
        } catch {
          return send(res, 400, { ok: false, error: '非法路径' });
        }
        const buf = await fs.readFile(p);
        // 优先用下载时记录的 content-type：扩展名和真实字节不一定一致
        let mime = null;
        try {
          const meta = await store.readMeta(slug);
          mime = (meta.assets || []).find((a) => a.file === file)?.mime || null;
        } catch {
          /* meta 读不到就按扩展名猜 */
        }
        res.writeHead(200, {
          'content-type': mime || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'content-length': buf.length,
          'cache-control': 'private, max-age=86400',
        });
        return res.end(buf);
      }

      return send(res, 404, { ok: false, error: 'no route' });
    } catch (err) {
      console.error('[readlater] route error', err);
      if (res.headersSent) return res.end();
      return send(res, 500, { ok: false, error: String(err?.message || err) });
    }
  };

  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler });
    console.log(`[readlater] 数据目录 ${store.root}`);
    return () => dispose();
  }, 'readlater: api routes');
}

export { PREFIX, PLATFORM_LABEL };
