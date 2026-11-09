/**
 * 阅读视图渲染。
 *
 * 视觉跟随 ~/Code/dsh-panel-kit 的《自建面板设计规范》：
 *   同纸（暖白 #fffcf6）、同墨（#1b1813 / #4b453a / #7f7666）、同信号色（#a8452f）、
 *   同一套衬线刊头。日/夜两套令牌，发丝线在夜里换值。
 *
 * 这里生成的 HTML **是我们自己拼的**，不是把站点 DOM 原样存下来 —— 所以没有 XSS 面，
 * 也不需要 sanitizer。小红书这种「文案 + 九宫格」本来就没有文章结构，
 * 硬转 Markdown 会丢排版；直接渲染成图文卡片才最接近原意。
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
  if (!stats) return [];
  const bits = [];
  if (stats.liked) bits.push(`赞 ${escapeHtml(stats.liked)}`);
  if (stats.collected) bits.push(`藏 ${escapeHtml(stats.collected)}`);
  if (stats.comment) bits.push(`评 ${escapeHtml(stats.comment)}`);
  return bits;
}

function mediaBlock(rec) {
  const assets = rec.assets || [];
  const images = assets.filter((a) => a.kind === 'image' && a.file);
  const video = assets.find((a) => a.kind === 'video');
  const out = [];

  if (video?.file) {
    out.push(
      `<figure class="rl-video"><video controls preload="metadata" src="assets/${escapeHtml(video.file)}"></video></figure>`,
    );
  } else if (video) {
    const mins = video.duration ? Math.round(video.duration / 60) : null;
    const label = video.skipped === 'too-large' ? '视频太大，未缓存' : '视频未缓存';
    out.push(
      `<div class="rl-stub"><span>${escapeHtml(label)}${mins ? ` · 约 ${mins} 分钟` : ''}</span>${video.url ? `<a href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">打开原视频</a>` : ''}</div>`,
    );
  }

  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    const ratio = img.w && img.h ? ` aspect-ratio:${img.w}/${img.h};` : '';
    // 首图不 lazy、不同步解码：打开就出图，避免一屏灰块
    const eager = i === 0 ? '' : ' loading="lazy"';
    out.push(
      `<figure class="rl-figure"><img src="assets/${escapeHtml(img.file)}" alt=""${eager}${img.w ? ` width="${img.w}"` : ''}${img.h ? ` height="${img.h}"` : ''} style="background:var(--rl-paper-2);${ratio}"></figure>`,
    );
  }
  return out.join('\n');
}

const CSS = `
:root{
  /* 同纸同墨：日版 */
  --rl-paper:#fffcf6; --rl-paper-2:#f1eadc;
  --rl-ink:#1b1813; --rl-ink-soft:#4b453a; --rl-ink-faint:#7f7666;
  --rl-line:rgba(27,24,19,.14); --rl-rule:rgba(27,24,19,.62);
  --rl-signal:#a8452f;
  --rl-serif:"Iowan Old Style","Songti SC","Source Han Serif SC","Noto Serif SC",Georgia,serif;
  --rl-mono:"SF Mono","JetBrains Mono",ui-monospace,Menlo,monospace;
  --rl-size:17px; --rl-leading:1.78; --rl-measure:34rem;
}
@media (prefers-color-scheme: dark){
  :root{
    --rl-paper:#232324; --rl-paper-2:#1b1c1e;
    --rl-ink:#f9fafb; --rl-ink-soft:#cfd3d6; --rl-ink-faint:#81858c;
    --rl-line:rgba(255,255,255,.06); --rl-rule:rgba(255,255,255,.12);
    --rl-signal:#ff6363;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--rl-paper); color:var(--rl-ink-soft);
  font-family:-apple-system,"SF Pro Text","PingFang SC","Helvetica Neue",Arial,sans-serif;
  font-size:var(--rl-size); line-height:var(--rl-leading);
  -webkit-font-smoothing:antialiased;
}
.rl-wrap{max-width:var(--rl-measure); margin:0 auto; padding:40px 30px 56px}

/* 刊头：眉标 → 题 → 元信息 → 署名线 */
.rl-kicker{
  display:flex; align-items:center; gap:8px; margin:0 0 14px;
  font-family:var(--rl-mono); font-size:10px; letter-spacing:.16em;
  text-transform:uppercase; color:var(--rl-ink-faint);
}
.rl-kicker i{width:5px; height:5px; background:var(--rl-signal); transform:rotate(45deg); flex:none}
h1{
  margin:0; font-family:var(--rl-serif); font-weight:600;
  font-size:1.72em; line-height:1.24; letter-spacing:-.012em; color:var(--rl-ink);
  text-wrap:balance;
}
.rl-meta{
  margin:12px 0 0; font-family:var(--rl-mono); font-size:11px;
  letter-spacing:.02em; color:var(--rl-ink-faint);
  display:flex; flex-wrap:wrap; gap:0 10px;
}
.rl-meta span{position:relative}
.rl-meta span + span::before{content:"·"; margin-right:10px; opacity:.55}
hr.rl-rule{border:0; border-top:1px solid var(--rl-rule); margin:18px 0 24px; opacity:.55}

/* 正文 */
.rl-body p{margin:0 0 1.05em}
.rl-body p:last-child{margin-bottom:0}

.rl-tags{
  margin:22px 0 0; font-size:12.5px; color:var(--rl-ink-faint);
  display:flex; flex-wrap:wrap; gap:4px 10px;
}
.rl-tags a{color:inherit; text-decoration:none}

/* 图版：整列竖排，圆角只用一个 8 */
.rl-gallery{margin:26px 0 0; display:flex; flex-direction:column; gap:10px}
.rl-figure{margin:0}
.rl-figure img{width:100%; height:auto; border-radius:8px; display:block; object-fit:cover}
.rl-video{margin:0}
.rl-video video{width:100%; border-radius:8px; display:block; background:#000}
.rl-stub{
  display:flex; gap:12px; align-items:center; justify-content:space-between;
  border:1px solid var(--rl-line); border-radius:8px; padding:12px 14px;
  font-size:12.5px; color:var(--rl-ink-faint);
}
.rl-stub a{color:var(--rl-ink-soft)}

/* 出处 */
.rl-src{
  margin:34px 0 0; padding-top:14px; border-top:1px solid var(--rl-line);
  font-family:var(--rl-mono); font-size:10.5px; letter-spacing:.02em;
  color:var(--rl-ink-faint); word-break:break-all;
}
.rl-src a{color:inherit; text-decoration:none; border-bottom:1px solid var(--rl-line)}
.rl-src a:hover{color:var(--rl-ink); border-bottom-color:var(--rl-ink)}

@media (max-width:520px){
  .rl-wrap{padding:28px 20px 44px}
  :root{--rl-size:16.5px}
}
@media (prefers-reduced-motion: reduce){*{transition:none!important; animation:none!important}}
`;

/**
 * @param {object} rec  meta.json 里的记录（含 assets）
 * @returns {string}    完整 HTML 文档
 */
export function renderNote(rec) {
  const title = escapeHtml(rec.title || '（无标题）');
  const site = rec.platformLabel ? escapeHtml(rec.platformLabel) : '';
  const author = rec.author ? escapeHtml(rec.author) : '';
  const date = fmtDate(rec.published);
  const ip = rec.ipLocation ? escapeHtml(rec.ipLocation) : '';

  const kicker = [site, author].filter(Boolean).join(' / ');
  const stats = statLine(rec.stats);
  const metaBits = [date, ip, ...stats].filter(Boolean);
  const tags = (rec.tags || []).length
    ? `<p class="rl-tags">${rec.tags.map((t) => `<span>#${escapeHtml(t)}</span>`).join('')}</p>`
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
  ${kicker ? `<p class="rl-kicker"><i></i>${kicker}</p>` : ''}
  <h1>${title}</h1>
  ${metaBits.length ? `<p class="rl-meta">${metaBits.map((b) => `<span>${b}</span>`).join('')}</p>` : ''}
  <hr class="rl-rule">
  <div class="rl-body">${paragraphs(rec.desc)}</div>
  ${tags}
  <div class="rl-gallery">
  ${mediaBlock(rec)}
  </div>
  <p class="rl-src">来源 <a href="${escapeHtml(rec.url || '')}" target="_blank" rel="noreferrer">${escapeHtml(rec.url || '')}</a></p>
</div>
</body>
</html>`;
}
