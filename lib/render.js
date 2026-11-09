/**
 * 阅读视图渲染。
 *
 * 这里生成的 HTML **是我们自己拼的**，不是把站点 DOM 原样存下来 —— 所以没有 XSS 面，
 * 也不需要 sanitizer。小红书这种「文案 + 九宫格」的内容本来就没有文章结构，
 * 硬转 Markdown 会丢排版；直接渲染成图文卡片才最接近原意。
 *
 * 后续接微信/知乎时，那两张要保留原 DOM，届时再上白名单清洗。
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const pad = (n) => String(n).padStart(2, '0');

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 小红书正文里的空行是有意义的（分段靠它），所以按空行切段。 */
function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function statLine(stats) {
  if (!stats) return '';
  const bits = [];
  if (stats.liked) bits.push(`赞 ${escapeHtml(stats.liked)}`);
  if (stats.collected) bits.push(`藏 ${escapeHtml(stats.collected)}`);
  if (stats.comment) bits.push(`评 ${escapeHtml(stats.comment)}`);
  return bits.length ? `<p class="rl-stats">${bits.join('<span class="rl-dot">·</span>')}</p>` : '';
}

function mediaBlock(rec) {
  const assets = rec.assets || [];
  const images = assets.filter((a) => a.kind === 'image' && a.file);
  const video = assets.find((a) => a.kind === 'video');

  const out = [];

  if (video?.file) {
    out.push(
      `<figure class="rl-video"><video controls preload="metadata" poster="${video.poster ? `assets/${escapeHtml(video.poster)}` : ''}" src="assets/${escapeHtml(video.file)}"></video></figure>`,
    );
  } else if (video) {
    const mins = video.duration ? Math.round(video.duration / 60) : null;
    const label = video.skipped === 'too-large' ? '视频太大，未缓存' : '视频未缓存';
    out.push(
      `<div class="rl-video-stub"><span>${escapeHtml(label)}${mins ? ` · 约 ${mins} 分钟` : ''}</span>${video.url ? `<a href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">打开原视频</a>` : ''}</div>`,
    );
  }

  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    const ratio = img.w && img.h ? ` aspect-ratio:${img.w}/${img.h};` : '';
    // 首图不 lazy、不同步解码：打开就出图，避免一屏灰块
    const eager = i === 0 ? '' : ' loading="lazy"';
    out.push(
      `<figure class="rl-figure"><img src="assets/${escapeHtml(img.file)}" alt=""${eager}${img.w ? ` width="${img.w}"` : ''}${img.h ? ` height="${img.h}"` : ''} style="background:#0001;${ratio}"></figure>`,
    );
  }

  return out.join('\n');
}

const CSS = `
:root{
  --rl-bg:#fbf9f5; --rl-fg:#1f1d1a; --rl-dim:#6f675d; --rl-line:#e6e0d6; --rl-chip:#efe9df;
  --rl-size:17px; --rl-leading:1.75; --rl-width:38rem;
}
@media (prefers-color-scheme: dark){
  :root{ --rl-bg:#16151a; --rl-fg:#e8e4dc; --rl-dim:#9a9389; --rl-line:#2b2930; --rl-chip:#26242c; }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--rl-bg); color:var(--rl-fg);
  font-family:-apple-system,"PingFang SC","SF Pro Text","Helvetica Neue",sans-serif;
  font-size:var(--rl-size); line-height:var(--rl-leading);
}
.rl-wrap{max-width:var(--rl-width); margin:0 auto; padding:28px 22px 64px}
header{margin-bottom:22px}
h1{font-size:1.42em; line-height:1.35; margin:0 0 10px; font-weight:600; letter-spacing:.01em}
.rl-meta{margin:0; color:var(--rl-dim); font-size:12.5px}
.rl-dot{margin:0 6px; opacity:.5}
.rl-stats{margin:6px 0 0; color:var(--rl-dim); font-size:12.5px}
.rl-body p{margin:0 0 1em}
.rl-tags{margin:18px 0 0; display:flex; flex-wrap:wrap; gap:6px}
.rl-tag{background:var(--rl-chip); color:var(--rl-dim); border-radius:999px; padding:3px 10px; font-size:12px}
.rl-figure{margin:0 0 14px}
.rl-figure img{width:100%; height:auto; border-radius:10px; display:block; object-fit:cover}
.rl-video{margin:0 0 18px}
.rl-video video{width:100%; border-radius:10px; display:block; background:#000}
.rl-video-stub{
  display:flex; gap:12px; align-items:center; justify-content:space-between;
  border:1px dashed var(--rl-line); border-radius:10px; padding:12px 14px; margin:0 0 18px;
  color:var(--rl-dim); font-size:13px;
}
.rl-video-stub a{color:inherit}
.rl-src{margin-top:36px; padding-top:14px; border-top:1px solid var(--rl-line); color:var(--rl-dim); font-size:12px}
.rl-src a{color:inherit; word-break:break-all}
`;

/**
 * @param {object} rec  meta.json 里的记录（含 assets）
 * @returns {string}    完整 HTML 文档
 */
export function renderNote(rec) {
  const title = escapeHtml(rec.title || '（无标题）');
  const author = rec.author ? escapeHtml(rec.author) : '';
  const date = fmtDate(rec.published);
  const ip = rec.ipLocation ? escapeHtml(rec.ipLocation) : '';

  const metaBits = [author, date, ip].filter(Boolean).join('<span class="rl-dot">·</span>');
  const tags = (rec.tags || []).length
    ? `<div class="rl-tags">${rec.tags.map((t) => `<span class="rl-tag">#${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<div class="rl-wrap">
  <header>
    <h1>${title}</h1>
    ${metaBits ? `<p class="rl-meta">${metaBits}</p>` : ''}
    ${statLine(rec.stats)}
  </header>
  <div class="rl-body">${paragraphs(rec.desc)}</div>
  ${tags}
  ${mediaBlock(rec)}
  <p class="rl-src">来源：<a href="${escapeHtml(rec.url || '')}" target="_blank" rel="noreferrer">${escapeHtml(rec.url || '')}</a></p>
</div>
</body>
</html>`;
}
