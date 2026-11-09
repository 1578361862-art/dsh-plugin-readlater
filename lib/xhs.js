/**
 * 小红书适配器。
 *
 * 为什么必须走浏览器（2026-11 实测，见 scripts/xhs.mjs 头注释）：
 *   裸 note URL 一律被风控 —— curl 404 / error_code 300031；
 *   无登录无头 Chrome 报 300012「当前网络存在风险」。
 *   只有 App/网页**分享出来的**链接带 xsec_token，那个 token 就足够匿名读全文。
 *
 * 所以这里的职责很窄：拿一条带 token 的 URL，开无头 Chrome，读 __INITIAL_STATE__，
 * 把图/视频抓下来。判断"能不能读"不在这里，在 getNote() 的超时里。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  if (process.env.READLATER_CHROME) return process.env.READLATER_CHROME;
  const candidates = [];
  // agent-browser 自带的 Chrome for Testing 优先：它不受系统 Chrome 自动更新影响。
  const abRoot = path.join(os.homedir(), '.agent-browser/browsers');
  try {
    for (const d of fs.readdirSync(abRoot).filter((x) => x.startsWith('chrome-')).sort().reverse()) {
      candidates.push(path.join(abRoot, d, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
    }
  } catch {
    /* 没装 agent-browser 也很正常 */
  }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error('找不到 Chrome；装一个 Chrome，或设 READLATER_CHROME 指向可执行文件');
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

async function waitForCdp(port, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('Chrome 的调试端口没起来');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((resolve) => ws.addEventListener('open', resolve));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(JSON.stringify(m.error)));
      else p.res(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send, ready, close: () => ws.close() };
}

/** 读笔记页里的 __INITIAL_STATE__。字段名跟着小红书内部结构走，改版时会失效。 */
const EXTRACT = `(() => {
  const s = window.__INITIAL_STATE__ || {};
  const dm = (s.note && s.note.noteDetailMap) || {};
  const k = Object.keys(dm).find((x) => dm[x] && dm[x].note);
  if (!k) return null;
  const n = dm[k].note;
  return {
    id: n.noteId,
    title: n.title || '',
    desc: n.desc || '',
    type: n.type || 'normal',
    time: n.time || null,
    ipLocation: n.ipLocation || null,
    user: { name: n.user?.nickname || '', id: n.user?.userId || '' },
    interact: {
      liked: n.interactInfo?.likedCount || '',
      collected: n.interactInfo?.collectedCount || '',
      comment: n.interactInfo?.commentCount || '',
      share: n.interactInfo?.shareCount || '',
    },
    tags: (n.tagList || []).map((t) => t.name).filter(Boolean),
    images: (n.imageList || []).map((i) => ({
      w: i.width || 0, h: i.height || 0,
      url: i.urlDefault || i.urlPre || i.url || '',
    })).filter((i) => i.url),
    video: n.video ? {
      duration: n.video.capa?.duration ?? null,
      cover: n.video.image?.thumbnailFileid || null,
      url: n.video.media?.stream?.h264?.[0]?.masterUrl || null,
    } : null,
    comments: (dm[k].comments?.list || []).slice(0, 20).map((c) => ({
      user: c.userInfo?.nickname || '', text: c.content || '', likeCount: c.likeCount || 0,
    })),
  };
})()`;

/**
 * 按魔数嗅探真实格式。
 *
 * 这里踩过一个坑：sns-webpic-qc.xhscdn.com 的 URL 以 .jpg 结尾，返回的字节却是 WebP。
 * 照 URL 命名会让扩展名和 MIME 一起说谎，浏览器按 image/jpeg 解释就是一块灰。
 */
export function sniffExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  if (buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (brand === 'avif' || brand === 'avis') return '.avif';
    return '.mp4';
  }
  return null;
}

const extFromMime = (mime) => {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webp')) return '.webp';
  if (m.includes('png')) return '.png';
  if (m.includes('gif')) return '.gif';
  if (m.includes('avif')) return '.avif';
  if (m.includes('mp4')) return '.mp4';
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  return null;
};

/** 只用于"还没下载、只需占个位"的场景。 */
const extOf = (url) => {
  const m = /\.(jpe?g|png|webp|gif|avif|mp4)(\?|$)/i.exec(url);
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
};

const refererFor = (url) => {
  try {
    return `https://${new URL(url).hostname}/`;
  } catch {
    return 'https://www.xiaohongshu.com/';
  }
};

async function download(url, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Referer: referer || refererFor(url),
        Accept: 'image/avif,image/webp,image/*,video/*,*/*;q=0.8',
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return { buf, contentType: r.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 打开笔记页并读出结构化数据。
 * @returns {Promise<{note: object, finalUrl: string}>}
 */
export async function readNote(url, { profileDir, timeoutMs = 30000, log = () => {} } = {}) {
  const chromePath = findChrome();
  const port = await freePort();
  if (profileDir) fs.mkdirSync(profileDir, { recursive: true });

  log(`chrome: ${path.basename(chromePath)} · port ${port}`);
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      // DSH 沙箱下这些是硬要求，否则 Chrome 起不来
      '--no-sandbox',
      '--disable-gpu',
      '--disable-crashpad',
      '--crash-dumps-dir=/tmp',
      `--user-data-dir=${profileDir || path.join(os.tmpdir(), 'readlater-chrome')}`,
      '--use-mock-keychain',
      '--disable-blink-features=AutomationControlled',
      '--disable-background-networking',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--window-size=1440,900',
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let page;
  try {
    await waitForCdp(port);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const t = targets.find((x) => x.type === 'page');
    if (!t) throw new Error('Chrome 没有可用的标签页');
    page = cdp(t.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setUserAgentOverride', {
      userAgent: UA,
      acceptLanguage: 'zh-CN,zh;q=0.9',
      platform: 'MacIntel',
    });

    log('navigate');
    await page.send('Page.navigate', { url });

    const deadline = Date.now() + timeoutMs;
    let note = null;
    while (Date.now() < deadline) {
      await sleep(1000);
      const r = await page.send('Runtime.evaluate', { expression: EXTRACT, returnByValue: true });
      if (r.result?.value) {
        note = r.result.value;
        break;
      }
    }

    const here = await page.send('Runtime.evaluate', {
      expression: 'JSON.stringify({url: location.href, title: document.title})',
      returnByValue: true,
    });
    let finalUrl = url;
    try {
      finalUrl = JSON.parse(here.result?.value || '{}').url || url;
    } catch {
      /* 拿不到就用原地址 */
    }

    if (!note) {
      const seen = JSON.parse(here.result?.value || '{}');
      throw new Error(
        `笔记详情没出现（可能是登录墙或风控）。当前页：${seen.url || '?'}`,
      );
    }
    return { note, finalUrl };
  } finally {
    try {
      page?.close();
    } catch {
      /* 已经断了 */
    }
    child.kill('SIGKILL');
  }
}

/**
 * 把笔记里的图片（和可选视频）落到 assets/，返回清单。
 * 单张失败不算整体失败：记到 failed 里，正文仍然可用。
 */
export async function saveAssets(note, dir, { wantVideo = false, maxVideoBytes = 300 * 1024 * 1024, log = () => {} } = {}) {
  const assets = [];
  const failed = [];
  fs.mkdirSync(dir, { recursive: true });

  for (let i = 0; i < (note.images?.length || 0); i += 1) {
    const img = note.images[i];
    const stem = `img-${String(i + 1).padStart(2, '0')}`;
    try {
      const { buf, contentType } = await download(img.url, 'https://www.xiaohongshu.com/');
      const ext = sniffExt(buf) || extFromMime(contentType) || extOf(img.url);
      const file = `${stem}${ext}`;
      fs.writeFileSync(path.join(dir, file), buf);
      assets.push({
        file, bytes: buf.length, kind: 'image',
        mime: contentType || null, w: img.w, h: img.h,
      });
      log(`img ${i + 1}/${note.images.length} ${Math.round(buf.length / 1024)}KB ${ext}`);
    } catch (err) {
      failed.push({ url: img.url, error: String(err?.message || err) });
      log(`img ${i + 1} 失败：${err?.message || err}`);
    }
  }

  if (note.video) {
    if (!wantVideo) {
      assets.push({ file: null, kind: 'video', url: note.video.url, duration: note.video.duration, skipped: 'not-downloaded' });
    } else if (!note.video.url) {
      failed.push({ url: null, error: '没有可直接下载的视频地址（可能是分片流）' });
    } else {
      try {
        const { buf, contentType } = await download(note.video.url, 'https://www.xiaohongshu.com/');
        if (buf.length > maxVideoBytes) {
          assets.push({ file: null, kind: 'video', url: note.video.url, duration: note.video.duration, skipped: 'too-large', bytes: buf.length });
        } else {
          const ext = sniffExt(buf) || extFromMime(contentType) || '.mp4';
          const file = `video${ext}`;
          fs.writeFileSync(path.join(dir, file), buf);
          assets.push({ file, bytes: buf.length, kind: 'video', mime: contentType || null, duration: note.video.duration });
          log(`video ${Math.round(buf.length / 1024)}KB ${ext}`);
        }
      } catch (err) {
        failed.push({ url: note.video.url, error: String(err?.message || err) });
        log(`video 失败：${err?.message || err}`);
      }
    }
  }

  return { assets, failed };
}
