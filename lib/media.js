/**
 * 抓取与素材落盘的公共件。小红书和微信都要用，所以从 xhs.js 抽出来。
 *
 * 这里踩过一个坑：图床的 URL 后缀和真实字节经常对不上
 * （sns-webpic-qc.xhscdn.com 给 .jpg 却是 WebP，mmbiz.qpic.cn 同理），
 * 照后缀命名会让扩展名和 MIME 一起说谎，浏览器按 image/jpeg 解释就是一块灰。
 * 所以一律按魔数嗅探。
 */

export const UA_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

/** 微信的正文要靠这个 UA 才给；普通桌面 UA 会撞「环境异常」。 */
export const UA_WECHAT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.42(0x18002a2a) NetType/WIFI Language/zh_CN';

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
  // 微信偶尔给 SVG
  const head = buf.toString('utf8', 0, 200).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return '.svg';
  return null;
}

export function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webp')) return '.webp';
  if (m.includes('png')) return '.png';
  if (m.includes('gif')) return '.gif';
  if (m.includes('avif')) return '.avif';
  if (m.includes('svg')) return '.svg';
  if (m.includes('mp4')) return '.mp4';
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  return null;
}

/** 只用于"还没下载、只需占个位"的场景。 */
export function extOfUrl(url) {
  const m = /\.(jpe?g|png|webp|gif|avif|svg|mp4)(\?|$)/i.exec(String(url || ''));
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
}

const refererOf = (url) => {
  try {
    return `https://${new URL(url).hostname}/`;
  } catch {
    return undefined;
  }
};

/** 下载到内存；调用方决定文件名与落盘位置。 */
export async function download(url, { ua = UA_DESKTOP, referer, timeoutMs = 25000, accept } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': ua,
        Referer: referer || refererOf(url),
        Accept: accept || 'image/avif,image/webp,image/*,video/*,*/*;q=0.8',
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return { buf, contentType: r.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

/** 取 HTML 文本。 */
export async function fetchHtml(url, { ua = UA_DESKTOP, referer, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': ua,
        Referer: referer || refererOf(url),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    const html = await r.text();
    return { ok: r.ok, status: r.status, html, finalUrl: r.url || url };
  } finally {
    clearTimeout(timer);
  }
}
