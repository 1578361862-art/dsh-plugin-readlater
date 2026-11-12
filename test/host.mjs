#!/usr/bin/env node
/**
 * 宿主路由自检：不启动 DSH，直接拿一个假的 ctx 把 apply() 跑起来，
 * 再用合成的 req/res 打真实路由。
 *
 *   node test/host.mjs
 *
 * 重点验两件事：
 *   /view 里 payload 的相对路径有没有被改写成同源绝对路径
 *   /asset 有没有按 meta 里记录的 mime 返回（不是按扩展名猜）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'readlater-test-'));
process.env.READLATER_ROOT = tmpRoot;

const { apply, PREFIX } = await import('../lib/index.js');
const { createStore, slugOf } = await import('../lib/store.js');
const { renderNote } = await import('../lib/render.js');

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
};

/* ---------- 起一个假宿主 ---------- */

let handler = null;
const ctx = {
  effect(fn) {
    fn();
  },
  webServer: {
    register({ kind, path: p, handler: h }) {
      check('注册为 prefix 路由', kind === 'prefix', kind);
      check('路由前缀正确', p === PREFIX, p);
      handler = h;
      return () => {};
    },
  },
};
apply(ctx);
check('handler 已注册', typeof handler === 'function');

/* ---------- 合成请求 ---------- */

function call(method, urlPath, body) {
  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(code, headers) {
        this.statusCode = code;
        this.headers = headers || {};
        return this;
      },
      end(data) {
        if (data !== undefined && data !== null) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
        resolve({ status: this.statusCode, headers: this.headers, body: Buffer.concat(chunks) });
      },
    };
    const req = {
      method,
      url: urlPath,
      headers: {},
      on(evt, cb) {
        if (evt === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
        if (evt === 'end') cb();
        return this;
      },
      destroy() {},
    };
    handler(req, res).catch((e) => resolve({ status: 500, headers: {}, body: Buffer.from(String(e)) }));
  });
}

/* ---------- 造一条记录 ---------- */

const slug = slugOf('xhs', 'ffffffffffffffffffffffff');
const store = createStore(tmpRoot);
const meta = {
  id: 'ffffffffffffffffffffffff', slug, platform: 'xhs', platformLabel: '小红书',
  url: 'https://www.xiaohongshu.com/explore/ffffffffffffffffffffffff',
  title: '测试笔记', author: '某人', published: '2026-11-06T00:00:00.000Z',
  saved: new Date().toISOString(), layout: 'gallery', tags: ['测试'], mediaBytes: 1234,
  assets: [{ file: 'img-01.webp', kind: 'image', bytes: 1234, mime: 'image/webp', w: 100, h: 140 }],
};
await store.save(meta, renderNote(meta));
fs.writeFileSync(path.join(store.dirOf(slug), 'assets', 'img-01.webp'), Buffer.from('RIFFxxxxWEBP'));

/* ---------- 打路由 ---------- */

const state = JSON.parse((await call('GET', '/readlater/api/state')).body.toString());
check('/state 返回条数', state.count === 1, String(state.count));
check('/state 带 queue', !!state.queue);

const list = JSON.parse((await call('GET', '/readlater/api/list')).body.toString());
check('/list 有一条', list.items?.length === 1);
check('/list 带缩略图名', list.items[0].thumb === 'img-01.webp', list.items[0].thumb);

const view = await call('GET', `/readlater/api/view/${slug}`);
const html = view.body.toString();
check('/view 返回 200', view.status === 200);
check('/view 是 HTML', String(view.headers['content-type']).includes('text/html'));
check('/view 把相对路径改成同源绝对路径', html.includes(`/readlater/api/asset/${slug}/img-01.webp`), '');
check('/view 没有残留相对 assets/', !html.includes('="assets/'));

const asset = await call('GET', `/readlater/api/asset/${slug}/img-01.webp`);
check('/asset 返回 200', asset.status === 200);
check('/asset 用 meta 里的 mime', asset.headers['content-type'] === 'image/webp', asset.headers['content-type']);

const bad = await call('GET', `/readlater/api/asset/${slug}/..%2F..%2Fmeta.json`);
check('路径逃逸被拒', bad.status >= 400, String(bad.status));

const notFound = await call('GET', '/readlater/api/nope');
check('未知路由 404', notFound.status === 404);

/* ---------- 标签 ---------- */
const t1 = await call('POST', '/readlater/api/tags', { slug, tags: [' 设计 ', '排版', '排版', ''] });
const t1b = JSON.parse(t1.body.toString());
check('/tags 保存成功', t1.status === 200 && t1b.ok === true, String(t1.status));
check('/tags 去空白与去重', JSON.stringify(t1b.record.tags) === JSON.stringify(['设计', '排版']), JSON.stringify(t1b.record.tags));
const t2 = await call('POST', '/readlater/api/tags', { slug, tags: [] });
check('/tags 可以清空', JSON.parse(t2.body.toString()).record.tags.length === 0);

/* ---------- 内容块编辑 ---------- */
const b1 = await call('GET', `/readlater/api/blocks?slug=${slug}`);
const b1b = JSON.parse(b1.body.toString());
check('/blocks 能派生出块', b1.status === 200 && Array.isArray(b1b.blocks) && b1b.blocks.length > 0, String(b1b.blocks?.length));

const b2 = await call('POST', '/readlater/api/blocks', {
  slug,
  title: '改过的标题',
  blocks: [{ type: 'p', text: '第一段改过了' }, { type: 'img', file: 'img-01.webp' }],
});
const b2b = JSON.parse(b2.body.toString());
check('/blocks 保存成功', b2.status === 200 && b2b.ok === true);
check('保存后标记 edited', b2b.record?.edited === true);
check('保存后标题更新', b2b.record?.title === '改过的标题', b2b.record?.title);

const view2 = await call('GET', `/readlater/api/view/${slug}`);
const html2 = view2.body.toString();
check('阅读页用上了改后的文本', html2.includes('第一段改过了'));
check('原有文本被替换', !html2.includes('这是测试摘要'));

const b3 = await call('POST', '/readlater/api/blocks/reset', { slug });
check('还原后 blocks 清空', b3.status === 200 && !JSON.parse(b3.body.toString()).record.blocks);

const added = await call('POST', '/readlater/api/add', { text: '这段文字里没有链接' });
const addedBody = JSON.parse(added.body.toString());
check('无链接时报错清楚', added.status === 400 && /没有链接/.test(addedBody.error), addedBody.error);

const wrong = await call('POST', '/readlater/api/add', { text: 'https://zhuanlan.zhihu.com/p/123456' });
const wrongBody = JSON.parse(wrong.body.toString());
check('未接的平台给出明确提示', wrong.status === 400 && /还没接上/.test(wrongBody.error), wrongBody.error);

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
