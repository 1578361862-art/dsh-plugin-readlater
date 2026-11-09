/**
 * 链接归一化：把"用户实际粘贴的东西"变成一条可抓取的 URL。
 *
 * 真实输入长这样，不是干净的 URL：
 *   56 【两个颜色，把照片印成海报】 😆 ...
 *   http://xhslink.com/a/AbCdEf，复制本条信息，打开【小红书】App查看精彩内容！
 *
 * 所以顺序是：抽 URL → 去尾巴标点 → scheme 归一 → 展开短链 → 认平台 → 取内容 id。
 *
 * 一条原则：**参数用白名单，不用黑名单**。小红书的 xsec_token 是唯一通行证，
 * 按"删掉 utm_*"的思路写，迟早会把 token 一起删掉。
 */

const UA_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** URL 会粘上中文标点和分享语，必须切干净。 */
const URL_RE = /(?:https?|xhsdiscover|snssdk1128):\/\/[^\s<>"'“”‘’（）【】「」《》，。！？；：、]+/g;
const TRAIL_RE = /[.,;:!?)\]】」》"'”’，。；：、]+$/;

/** 各平台域名 → 平台 id。顺序有意义：先具体后宽泛。 */
const HOSTS = [
  [/^xhslink\.com$/i, 'xhs'],
  [/(^|\.)xiaohongshu\.com$/i, 'xhs'],
  [/^mp\.weixin\.qq\.com$/i, 'wechat'],
  [/(^|\.)zhihu\.com$/i, 'zhihu'],
  [/(^|\.)douyin\.com$/i, 'douyin'],
  [/(^|\.)iesdouyin\.com$/i, 'douyin'],
];

export const SUPPORTED = ['xhs', 'wechat', 'zhihu', 'douyin'];

export function platformOf(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const [re, id] of HOSTS) if (re.test(host)) return id;
  return null;
}

/** 从分享文本里挑一条最像样的 URL（优先能认出平台的，其次取第一条）。 */
export function pickUrl(text) {
  const s = String(text ?? '');
  const hits = (s.match(URL_RE) || [])
    .map((u) => u.replace(TRAIL_RE, ''))
    .filter(Boolean);
  if (!hits.length) return null;
  const known = hits.find((u) => platformOf(toHttp(u)));
  return known || hits[0];
}

/** App scheme 换成 https。小红书的 scheme 不带 token，只能当兜底。 */
export function toHttp(url) {
  const s = String(url ?? '');
  if (/^xhsdiscover:\/\//i.test(s)) {
    const rest = s.replace(/^xhsdiscover:\/\//i, '');
    const m = /^(?:item|note|discovery\/item)\/([\w]+)/i.exec(rest);
    if (m) return `https://www.xiaohongshu.com/explore/${m[1]}`;
    return `https://www.xiaohongshu.com/${rest}`;
  }
  if (/^snssdk1128:\/\//i.test(s)) {
    const m = /(?:aweme\/detail|video|note)\/([\w]+)/i.exec(s);
    if (m) return `https://www.douyin.com/video/${m[1]}`;
  }
  return s;
}

/** 各平台的内容 id。拿不到就是 null，交给上层报"认不出来"。 */
export function contentIdOf(url, platform) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const p = u.pathname;
  switch (platform) {
    case 'xhs': {
      const m = /^\/(?:explore|discovery\/item)\/([0-9a-f]{24})/i.exec(p);
      return m ? m[1] : null;
    }
    case 'wechat': {
      const m = /^\/s\/([\w-]+)/.exec(p);
      if (m) return m[1];
      const sn = u.searchParams.get('sn');
      const mid = u.searchParams.get('mid');
      const idx = u.searchParams.get('idx');
      return sn || (mid ? `${mid}-${idx || '1'}` : null);
    }
    case 'zhihu': {
      const a = /^\/question\/(\d+)\/answer\/(\d+)/.exec(p);
      if (a) return `q${a[1]}a${a[2]}`;
      const z = /^\/p\/(\d+)/.exec(p);
      if (z) return `p${z[1]}`;
      const pin = /^\/pin\/(\d+)/.exec(p);
      return pin ? `pin${pin[1]}` : null;
    }
    case 'douyin': {
      const v = /\/(?:video|note|share\/video)\/(\d+)/.exec(p);
      return v ? v[1] : null;
    }
    default:
      return null;
  }
}

/**
 * 跟着 3xx 走，把短链展开成最终地址。
 * 手动一跳一跳走，是为了**保留中间结果**：出错时能说清楚卡在哪一跳。
 */
export async function expand(url, { maxHops = 5, timeoutMs = 15000 } = {}) {
  const hops = [];
  let cur = toHttp(url);
  for (let i = 0; i < maxHops; i += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let r;
    try {
      r = await fetch(cur, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA_IOS,
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      try {
        await r.body?.cancel();
      } catch {
        /* 已经消费掉了 */
      }
      if (!loc) break;
      const next = new URL(loc, cur).href;
      hops.push(next);
      cur = next;
      continue;
    }
    try {
      await r.body?.cancel();
    } catch {
      /* 同上 */
    }
    break;
  }
  return { url: cur, hops };
}

/**
 * 对外展示/存档用的干净地址。
 *
 * 分享链接里常带一次性凭证（小红书的 xsec_token、各种 utm_*），
 * 那是访问令牌不是网址：抓取时必须有，写进 Obsidian 就是泄露。
 */
export function canonicalUrlOf(url, platform, id) {
  if (platform === 'xhs' && id) return `https://www.xiaohongshu.com/explore/${id}`;
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  for (const k of ['xsec_token', 'xsec_source', 'chksm', 'scene', 'from', 'isappinstalled', 'share_code', 'utm_psn']) {
    u.searchParams.delete(k);
  }
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.href;
}

/**
 * 主入口。
 * @returns {{ok: boolean, platform: string|null, url: string, id: string|null,
 *            hops: string[], error?: string}}
 */
export async function normalize(text, opts = {}) {
  const picked = pickUrl(text);
  if (!picked) {
    return { ok: false, platform: null, url: '', id: null, hops: [], error: '这段文字里没有链接' };
  }

  let url = toHttp(picked);
  let platform = platformOf(url);
  const hops = [];

  // 短链域名本身认不出内容 id，必须先展开。
  const needsExpand = !contentIdOf(url, platform) || /xhslink\.com|v\.douyin\.com|link\.zhihu\.com/i.test(url);
  if (needsExpand) {
    try {
      const r = await expand(url, opts);
      if (r.url !== url) {
        url = r.url;
        hops.push(...r.hops);
        platform = platformOf(url) || platform;
      }
    } catch (err) {
      return {
        ok: false, platform, url, id: null, hops,
        error: `短链展开失败：${err?.message || err}`,
      };
    }
  }

  const id = contentIdOf(url, platform);
  if (!platform) {
    return { ok: false, platform: null, url, id: null, hops, error: '暂不支持这个站点' };
  }
  if (!id) {
    return { ok: false, platform, url, id: null, hops, error: '认不出内容 id（链接可能被截断了）' };
  }
  return { ok: true, platform, url, id, hops };
}
