/**
 * 微信公众号适配器。
 *
 * 现实比文档复杂（2026-11 实测）：即使带上微信移动端 UA，
 * 服务端也只返回 `secitptpage/verify` 这个 JS 壳，正文要等挑战脚本跑完才出现。
 * 所以策略是**两级**：
 *   1. 先试纯 HTTP（快，个别网络/文章能直接拿到）
 *   2. 拿不到 #js_content 或撞上 verify 壳，就开无头 Chrome 渲染一遍
 *
 * 另外两个必须做对的地方：
 *   - 图片在 data-src，src 是空的，不先换过来一张图都拿不到；
 *   - 「图片消息」形态（item_show_type=8）整页是相册，走 gallery，不走长文排版。
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { fetchHtml, download, sniffExt, extFromMime, extOfUrl, UA_WECHAT } from './media.js';
import { withSession } from './browser.js';
import { parseBody, sanitizeBody, revealLazyImages, localizeImages, toHtml } from './sanitize.js';

const REFERER = 'https://mp.weixin.qq.com/';

/** 限流/风控：不是文章的问题，等一会儿或降低频率再试。 */
const THROTTLED = /环境异常|完成验证后即可继续访问|去验证/;

/** 明确表示"这篇没了"的文案，命中就直接报清楚，不必再试浏览器。 */
const GONE = [
  [/此账号已自主注销|账号已注销/, '该公众号已注销'],
  [/该内容已被发布者删除|此内容因违规无法查看/, '内容已删除或不可见'],
  [/该公众号已迁移|账号已迁移/, '该公众号已迁移'],
];

/** 从页面里抠 `window.xxx = {…}` 的 JSON 字面量（配平花括号，跳过字符串）。 */
function extractJsonAssignment(html, name) {
  const at = html.indexOf(name);
  if (at < 0) return null;
  const eq = html.indexOf('=', at + name.length);
  if (eq < 0) return null;
  let i = html.indexOf('{', eq);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  let inStr = false;
  let quote = '';
  for (; i < html.length; i += 1) {
    const c = html[i];
    if (inStr) {
      if (c === '\\') i += 1;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** "2026年11月9日 10:00" / "2026-11-09" / "1699512345" → ISO */
function parseTime(...candidates) {
  for (const raw of candidates) {
    if (raw === null || raw === undefined) continue;
    const s = String(raw).trim();
    if (!s) continue;
    if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString();
    if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString();
    const cn = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2}))?/.exec(s);
    if (cn) {
      const [, y, mo, d, hh, mm] = cn;
      return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh || 0), Number(mm || 0)).toISOString();
    }
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (iso) {
      const [, y, mo, d] = iso;
      return new Date(Number(y), Number(mo) - 1, Number(d)).toISOString();
    }
  }
  return null;
}

const hasContent = (html) => /id=["']js_content["']/.test(html);

/** 浏览器兜底：渲染到正文出现为止，返回序列化后的 DOM。 */
async function htmlViaBrowser(url, { profileDir, log }) {
  return withSession({ profileDir, log }, async (page) => {
    await page.open(url, { ua: UA_WECHAT, platform: 'iPhone' });
    const ok = await page.waitFor('!!document.getElementById("js_content")', { timeoutMs: 25000, intervalMs: 800 });
    const finalUrl = (await page.url()) || url;
    const text = await page.evaluate('document.body.innerText.slice(0,200)');
    if (!ok) {
      for (const [re, why] of GONE) if (re.test(String(text))) throw new Error(`微信返回：${why}`);
      if (THROTTLED.test(String(text))) {
        throw new Error('微信要求人机验证（短时间内请求过多）。等几分钟再试，或在手机微信里打开一次这篇');
      }
      throw new Error(`正文没渲染出来（可能是验证页）。页面开头：${String(text || '').slice(0, 60)}`);
    }
    return { html: await page.dom(), finalUrl };
  });
}

/**
 * @returns {Promise<{
 *   kind:'article'|'gallery', title:string, author:string, siteName:string,
 *   published:string|null, desc:string, bodyHtml:string,
 *   images:Array<{url:string}>, assets:object[], failed:object[], via:string
 * }>}
 */
export async function readArticle(url, { assetsDir, profileDir, log = () => {}, html: injected } = {}) {
  let html;
  let finalUrl = url;
  let via = 'http';

  const fast = injected ? { html: injected, finalUrl: url } : await fetchHtml(url, { ua: UA_WECHAT, referer: REFERER });
  if (injected) {
    html = injected;
    via = 'fixture';
  } else if (hasContent(fast.html)) {
    html = fast.html;
    finalUrl = fast.finalUrl;
  } else {
    for (const [re, why] of GONE) if (re.test(fast.html)) throw new Error(`微信返回：${why}`);
    log('纯 HTTP 只拿到验证壳，改用浏览器');
    via = 'browser';
    ({ html, finalUrl } = await htmlViaBrowser(url, { profileDir, log }));
  }

  for (const [re, why] of GONE) if (re.test(html)) throw new Error(`微信返回：${why}`);

  const { document } = parseHTML(html);
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
  const meta = (prop) =>
    document.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') ||
    document.querySelector(`meta[name="${prop}"]`)?.getAttribute('content') ||
    '';

  const cgi = extractJsonAssignment(html, 'window.cgiDataNew') || {};
  const itemShowType = String(
    cgi.item_show_type ?? extractJsonAssignment(html, 'window.item_show_type') ?? '',
  );

  const title =
    text('#activity-name') ||
    meta('og:title') ||
    (/var\s+msg_title\s*=\s*"([^"]*)"/.exec(html)?.[1] ?? '') ||
    String(document.title || '').replace(/\s*[-—].*$/, '');

  const account =
    text('#js_name') ||
    meta('weixin:account') ||
    meta('og:article:author') ||
    (/var\s+nickname\s*=\s*"([^"]*)"/.exec(html)?.[1] ?? '');

  const author = text('#js_author_name') || '';
  const published = parseTime(
    text('#publish_time'),
    /var\s+create_time\s*=\s*"(\d+)"/.exec(html)?.[1],
    meta('article:published_time'),
  );
  const desc = meta('og:description');

  /* ---------- 图片消息：整页是相册 ---------- */
  if (itemShowType === '8') {
    const list = Array.isArray(cgi.picture_page_info_list) ? cgi.picture_page_info_list : [];
    const urls = list
      .map((p) => p?.cdn_url)
      .filter((u) => typeof u === 'string' && /^https?:/i.test(u));
    if (!urls.length) throw new Error('图片消息里没找到相册（可能是懒加载没触发）');

    fs.mkdirSync(assetsDir, { recursive: true });
    const assets = [];
    const failed = [];
    for (let i = 0; i < urls.length; i += 1) {
      const stem = `img-${String(i + 1).padStart(2, '0')}`;
      try {
        const { buf, contentType } = await download(urls[i], { ua: UA_WECHAT, referer: REFERER });
        const ext = sniffExt(buf) || extFromMime(contentType) || extOfUrl(urls[i]);
        const file = `${stem}${ext}`;
        fs.writeFileSync(path.join(assetsDir, file), buf);
        assets.push({ file, bytes: buf.length, kind: 'image', mime: contentType || null });
        log(`img ${i + 1}/${urls.length} ${Math.round(buf.length / 1024)}KB ${ext}`);
      } catch (err) {
        failed.push({ url: urls[i], error: String(err?.message || err) });
        log(`img ${i + 1} 失败：${err?.message || err}`);
      }
    }

    return {
      kind: 'gallery', title, author: author || account, siteName: account,
      published, desc: '', bodyHtml: '', images: urls.map((u) => ({ url: u })),
      assets, failed, finalUrl, via,
    };
  }

  /* ---------- 普通文章 ---------- */
  const contentEl = document.getElementById('js_content') || document.querySelector('.rich_media_content');
  if (!contentEl) throw new Error('没找到正文容器 #js_content（页面结构可能变了）');

  const sourceHtml = contentEl.innerHTML;
  const { root } = parseBody(sourceHtml);
  // 正文里常见的残留块：二维码、赞赏、推荐、广告
  for (const sel of ['#js_pc_qr_code', '.qr_code_pc', '.reward_area', '.js_ad_area', '.rich_media_tool', '.js_uneditable']) {
    for (const el of Array.from(root.querySelectorAll(sel))) el.remove();
  }

  sanitizeBody(root);
  const imgNodes = revealLazyImages(root);
  const { assets, failed } = await localizeImages(imgNodes, assetsDir, {
    ua: UA_WECHAT,
    referer: finalUrl || url,
    log,
  });

  return {
    kind: 'article', title, author: author || account, siteName: account,
    published, desc, bodyHtml: toHtml(root), images: [], assets, failed, finalUrl, via,
  };
}
