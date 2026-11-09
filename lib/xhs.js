/**
 * 小红书适配器。
 *
 * 为什么必须走浏览器（2026-11 实测，见 scripts/xhs.mjs 头注释）：
 *   裸 note URL 一律被风控 —— curl 404 / error_code 300031；
 *   无登录无头 Chrome 报 300012「当前网络存在风险」。
 *   只有 App/网页**分享出来的**链接带 xsec_token，那个 token 就足够匿名读全文。
 *
 * 所以这里的职责很窄：拿一条带 token 的 URL，开无头 Chrome，读 __INITIAL_STATE__，
 * 把图/视频抓下来。判断"能不能读"不在这里，在 waitFor 的超时里。
 */

import fs from 'node:fs';
import path from 'node:path';
import { withSession } from './browser.js';
import { download, sniffExt, extFromMime, extOfUrl, UA_DESKTOP } from './media.js';

export { sniffExt, extFromMime, extOfUrl };

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
 * 打开笔记页并读出结构化数据。
 * @returns {Promise<{note: object, finalUrl: string}>}
 */
export async function readNote(url, { profileDir, timeoutMs = 30000, log = () => {} } = {}) {
  return withSession({ profileDir, log }, async (page) => {
    await page.open(url, { ua: UA_DESKTOP, platform: 'MacIntel' });
    const note = await page.waitFor(EXTRACT, { timeoutMs });
    const finalUrl = (await page.url()) || url;
    if (!note) {
      throw new Error(`笔记详情没出现（可能是登录墙或风控）。当前页：${finalUrl}`);
    }
    // 页面结构在、内容却空 —— 通常是 token 失效或笔记已删除。
    // 不判这一条的话会把"空笔记"当成成功写进库里。
    if (!note.title && !note.desc && !(note.images || []).length) {
      const pageText = String((await page.evaluate('document.body.innerText.slice(0,300)')) || '');
      // 注意：匿名页的导航里永远有「登录」两个字，不能拿它当墙的信号。
      // 只认真实拦截页的文案。
      const gone = /暂时无法浏览|笔记不存在|已删除|内容无法查看|该笔记已被|当前笔记/.test(pageText);
      const wall = /扫码登录|请先登录|安全验证|环境异常|操作过于频繁|访问过于频繁/.test(pageText);
      if (wall && !gone) {
        const err = new Error(`小红书要求验证或登录（${pageText.replace(/\s+/g, ' ').slice(0, 40)}）`);
        err.throttled = true;
        throw err;
      }
      throw new Error(gone ? '笔记不可见（可能已删除或设为私密）' : '笔记内容为空（token 可能已过期）');
    }
    return { note, finalUrl };
  });
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
      const { buf, contentType } = await download(img.url, { ua: UA_DESKTOP, referer: 'https://www.xiaohongshu.com/' });
      const ext = sniffExt(buf) || extFromMime(contentType) || extOfUrl(img.url);
      const file = `${stem}${ext}`;
      fs.writeFileSync(path.join(dir, file), buf);
      assets.push({ file, bytes: buf.length, kind: 'image', mime: contentType || null, w: img.w, h: img.h });
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
        const { buf, contentType } = await download(note.video.url, { ua: UA_DESKTOP, referer: 'https://www.xiaohongshu.com/' });
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
