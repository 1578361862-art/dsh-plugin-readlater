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
import { project, unproject, writeIndex, resolveVault, contentHash as baseHash, shortId, fileNameOf } from './project.js';
import { createThrottle } from './throttle.js';
import { createIngest, SUPPORTED, nowIso } from './ingest.js';
import { renderNote } from './render.js';
import { deriveBlocks, normalizeBlocks, blocksText } from './blocks.js';

/** Cordis 插件名。 */
export const name = 'readlater';

/** 需要 Web 服务器的具名路由表。 */
export const inject = ['webServer'];

const PREFIX = '/readlater/api';
const PLATFORM_LABEL = { xhs: '小红书', wechat: '微信公众号', zhihu: '知乎', douyin: '抖音' };
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

/** 任何一步都不许无限等：超时就报错，队列继续往下走。 */
/** 给全文检索用的纯文本；只是索引料，不参与展示。 */
export function apply(ctx) {
  const store = createStore(process.env.READLATER_ROOT || defaultRoot());
  const profileDir = path.join(store.root, 'profile');
  // 平台级刹车：微信的冷却状态落盘在数据目录里，重启不清零
  const throttle = createThrottle({ file: path.join(store.root, 'state', 'throttle.json'), label: '微信' });

  /** 串行队列：同时只跑一个链接，状态给面板轮询。 */
  const queue = { pending: 0, busy: false, current: null, lastError: null };
  /**
   * 任务清单。面板靠它画"处理中"列表：排队、进行到哪一步、完成了几条。
   * 只保留最近 20 条，已完成的留 60 秒供前端弹提示，之后自动滚掉。
   */
  const jobs = [];
  const JOB_KEEP = 20;
  const JOB_DONE_TTL = 60_000;
  let jobSeq = 0;

  const pruneJobs = () => {
    const t = Date.now();
    for (let i = jobs.length - 1; i >= 0; i -= 1) {
      const j = jobs[i];
      if (j.status === 'done' || j.status === 'failed') {
        if (t - (j.finishedAt || j.at) > JOB_DONE_TTL) jobs.splice(i, 1);
      }
    }
    while (jobs.length > JOB_KEEP) jobs.shift();
  };

  const activeJobs = () => jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  let currentJobId = null;
  const ingestImpl = createIngest({
    store,
    throttle,
    profileDir,
    progress: (p) => {
      queue.current = p;
      const job = jobs.find((j) => j.id === currentJobId);
      if (job && p?.step) job.step = p.step;
    },
  });
  let chain = Promise.resolve();

  const enqueue = (fn, job) => {
    queue.pending += 1;
    const run = chain.then(async () => {
      queue.pending -= 1;
      queue.busy = true;
      if (job) {
        job.status = 'running';
        job.startedAt = Date.now();
        job.step = '准备中';
        currentJobId = job.id;
      }
      try {
        const out = await fn();
        if (job) {
          job.status = 'done';
          job.step = '完成';
          job.finishedAt = Date.now();
          job.title = out?.record?.title || job.label;
        }
        return out;
      } catch (err) {
        if (job) {
          job.status = 'failed';
          job.step = String(err?.message || err).slice(0, 60);
          job.finishedAt = Date.now();
        }
        throw err;
      } finally {
        queue.busy = false;
        queue.current = null;
        currentJobId = null;
        pruneJobs();
      }
    });
    // 队列不能因为一条失败就断掉
    chain = run.catch(() => {});
    return run;
  };

  /** 抓一篇小红书：解析 → 落资产 → 渲染 → 存盘。 */
  /** 把一篇投到 vault，并把投影信息写回 meta。 */
  async function projectOne(slug) {
    const meta = await store.readMeta(slug);
    const body = meta.hasBody ? (await store.readBody(slug)) || '' : '';
    const r = await project(meta, body, { libraryDir: store.libraryDir });
    const next = {
      ...meta,
      projectedAt: nowIso(),
      projectedHash: meta.contentHash || contentHashOf(meta, body),
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

  /** blocks 也算内容：编辑过的文章要能和投影里的版本比对出差异 */
  const contentHashOf = (meta, bodyHtml) => `${baseHash(meta, bodyHtml)}:${JSON.stringify(meta.blocks || null).length}`;

  /** 读取/生成块（不改盘）：编辑器打开时先看一份可编辑的草稿 */
  async function loadBlocks(slug) {
    const meta = await store.readMeta(slug);
    const bodyHtml = meta.hasBody ? (await store.readBody(slug)) || '' : '';
    const stored = Array.isArray(meta.blocks) && meta.blocks.length ? meta.blocks : null;
    return {
      meta,
      bodyHtml,
      blocks: stored || deriveBlocks(meta, bodyHtml),
      edited: !!meta.edited,
    };
  }

  /** 保存编辑结果：写回块、重渲染、必要时重投。 */
  async function saveBlocks(slug, rawBlocks, title) {
    const { meta, bodyHtml } = await loadBlocks(slug);
    const known = (meta.assets || []).filter((a) => a.kind === 'image' && a.file).map((a) => a.file);
    const blocks = normalizeBlocks(rawBlocks, known);

    const next = {
      ...meta,
      blocks,
      edited: true,
      title: String(title || meta.title || '').trim() || meta.title,
      updated: nowIso(),
    };
    next.text = [next.title, blocksText(blocks, 2000), (next.tags || []).join(' ')]
      .filter(Boolean)
      .join('\n');
    next.contentHash = contentHashOf(next, bodyHtml);

    let reprojected = false;
    if (next.projectedAt) {
      try {
        await project(next, bodyHtml, { libraryDir: store.libraryDir });
        next.projectedHash = next.contentHash;
        next.projectedAt = nowIso();
        await rebuildIndex();
        reprojected = true;
      } catch (err) {
        console.error('[readlater] 编辑已存，但重投失败', err?.message || err);
      }
    }

    await store.save(next, renderNote(next, { bodyHtml }), next.hasBody ? bodyHtml : undefined);
    return { record: next, reprojected };
  }

/** 写标签：重渲染 + 已投影的顺手重投。返回更新后的 meta（带 _reprojected 标记）。 */
  async function applyTags(slug, nextTags) {
    const meta = await store.readMeta(slug);
    const tags = [...new Set((nextTags || []).map((t) => String(t || '').trim()).filter(Boolean))].slice(0, 20);
    const next = { ...meta, tags, updated: nowIso() };
    const bodyHtml = next.hasBody ? (await store.readBody(slug)) || '' : '';
    next.contentHash = contentHashOf(next, bodyHtml);

    let reprojected = false;
    if (next.projectedAt) {
      try {
        await project(next, bodyHtml, { libraryDir: store.libraryDir });
        next.projectedHash = next.contentHash;
        next.projectedAt = nowIso();
        reprojected = true;
      } catch (err) {
        console.error('[readlater] 标签已存，但重投失败', err?.message || err);
      }
    }
    await store.save(next, renderNote(next, { bodyHtml }), next.hasBody ? bodyHtml : undefined);
    return { ...next, _reprojected: reprojected };
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname.slice(PREFIX.length);

    try {
      /* ---------- 状态 ---------- */
      if (route === '/state' && req.method === 'GET') {
        pruneJobs();
        const active = activeJobs();
        const recentDone = jobs.filter((j) => j.status === 'done' && Date.now() - (j.finishedAt || 0) < 60_000);
        return send(res, 200, {
          ok: true,
          ...(await store.stats()),
          queue,
          throttle: throttle.status(),
          jobs: jobs.slice(-12),
          jobStats: { running: active.filter((j) => j.status === 'running').length, queued: active.filter((j) => j.status === 'queued').length, done: recentDone.length },
        });
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
            edited: !!m.edited,
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

        const job = {
          id: `j${++jobSeq}`,
          label: String(text).replace(/\s+/g, ' ').slice(0, 70),
          platform: norm.platform,
          status: 'queued',
          step: '排队中',
          at: Date.now(),
        };
        jobs.push(job);
        const result = await enqueue(() => ingestImpl.ingest(norm, { video: !!body.video }), job);
        return send(res, 200, { ok: true, ...result, normalized: { url: norm.url } });
      }

      /* ---------- 重新解析 ---------- */
      if (route === '/refresh' && req.method === 'POST') {
        const body = await readJson(req);
        const old = await store.readMeta(String(body.slug || ''));
        // 改过的文章重新解析会把编辑冲掉，必须显式确认
        if (old.edited && !body.discardEdits) {
          return send(res, 409, {
            ok: false,
            error: '这篇你编辑过，重新解析会丢弃编辑。确认请带 discardEdits 再来。',
            edited: true,
          });
        }
        const norm = await normalize(old.sourceUrl || old.url);
        if (!norm.ok) return send(res, 400, { ok: false, error: norm.error || '无法重新解析' });
        if (!SUPPORTED.includes(norm.platform)) {
          return send(res, 400, { ok: false, error: `${PLATFORM_LABEL[norm.platform] || norm.platform} 还没接上` });
        }
        const job = {
          id: `j${++jobSeq}`,
          label: `重新解析 · ${old.title || norm.id}`,
          platform: norm.platform,
          status: 'queued',
          step: '排队中',
          at: Date.now(),
        };
        jobs.push(job);
        const result = await enqueue(() => ingestImpl.ingest(norm, { refresh: true, video: !!body.video }), job);
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
        const slug = String(body.slug || '');
        // 删本地也要删投影，否则 Obsidian 里留下指向空条目的孤儿
        let unprojected = 0;
        try {
          const meta = await store.readMeta(slug);
          if (meta.projectedAt) {
            const r = await unproject(meta);
            unprojected = r.removed;
            await rebuildIndex();
          }
        } catch {
          /* 记录不存在就没什么可撤销的 */
        }
        await store.remove(slug);
        return send(res, 200, { ok: true, unprojected });
      }

      if (route === '/delete-batch' && req.method === 'POST') {
        const body = await readJson(req);
        const slugs = Array.isArray(body.slugs) ? body.slugs.map(String) : [];
        let deleted = 0;
        let unprojected = 0;
        for (const slug of slugs) {
          try {
            const meta = await store.readMeta(slug);
            if (meta.projectedAt) {
              const r = await unproject(meta);
              unprojected += r.removed;
            }
            await store.remove(slug);
            deleted += 1;
          } catch {
            /* 单条失败不中断整批 */
          }
        }
        if (unprojected) await rebuildIndex();
        return send(res, 200, { ok: true, deleted, unprojected });
      }

      /* ---------- 内容编辑 ---------- */
      if (route === '/blocks' && req.method === 'GET') {
        const slugParam = String(url.searchParams.get('slug') || '');
        if (!slugParam) return send(res, 400, { ok: false, error: '缺少 slug' });
        let blocks;
        let edited;
        let meta;
        try {
          ({ blocks, edited, meta } = await loadBlocks(slugParam));
        } catch {
          return send(res, 404, { ok: false, error: '没有这篇' });
        }
        return send(res, 200, {
          ok: true,
          edited,
          blocks,
          title: meta.title,
          layout: meta.layout,
          // 站点长文第一次进编辑器时格式会被简化，前端据此提示
          derived: !!(meta.layout === 'article' && !edited),
        });
      }

      if (route === '/blocks' && req.method === 'POST') {
        const body = await readJson(req);
        const r = await saveBlocks(String(body.slug || ''), body.blocks, body.title);
        return send(res, 200, { ok: true, ...r });
      }

      if (route === '/blocks/reset' && req.method === 'POST') {
        const body = await readJson(req);
        const slug = String(body.slug || '');
        const meta = await store.readMeta(slug);
        const bodyHtml = meta.hasBody ? (await store.readBody(slug)) || '' : '';
        const next = { ...meta, blocks: null, edited: false, updated: nowIso() };
        next.text = [next.title, next.desc, (next.tags || []).join(' ')].filter(Boolean).join('\n');
        next.contentHash = contentHashOf(next, bodyHtml);
        await store.save(next, renderNote(next, { bodyHtml }), next.hasBody ? bodyHtml : undefined);
        return send(res, 200, { ok: true, record: next });
      }

      /* ---------- 标签 ---------- */
      if (route === '/tags' && req.method === 'POST') {
        const body = await readJson(req);
        const r = await applyTags(String(body.slug || ''), Array.isArray(body.tags) ? body.tags : []);
        const { _reprojected, ...record } = r;
        if (_reprojected) await rebuildIndex();
        return send(res, 200, { ok: true, record, reprojected: !!_reprojected });
      }

      /* ---------- 批量打标签 ---------- */
      if (route === '/tags-batch' && req.method === 'POST') {
        const body = await readJson(req);
        const slugs = Array.isArray(body.slugs) ? body.slugs.map(String) : [];
        const add = Array.isArray(body.add) ? body.add.map(String) : [];
        let changed = 0;
        let reprojected = 0;
        for (const slug of slugs) {
          try {
            const meta = await store.readMeta(slug);
            const r = await applyTags(slug, [...(meta.tags || []), ...add]);
            changed += 1;
            if (r._reprojected) reprojected += 1;
          } catch (err) {
            console.error('[readlater] 批量标签失败', slug, err?.message || err);
          }
        }
        if (reprojected) await rebuildIndex();
        return send(res, 200, { ok: true, changed, reprojected });
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
