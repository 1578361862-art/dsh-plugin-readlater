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

/**
 * 小红书会把话题以 `##话题[话题]# ##另一个[话题]#` 的形式追加进正文，
 * 和下面的标签行重复，读起来是噪音。渲染前剔掉。
 */
function cleanDesc(text) {
  return String(text || '')
    // 小红书的话题尾部格式并不统一：`##A[话题]#` 与 `#B[话题]#` 会混着出现，
    // 所以不猜前缀长度，把 `#…[话题]#` 整段连同残留的 `[话题]#` 一起删掉。
    .replace(/#{1,3}[^\s#]{1,30}\[话题\]#/g, '')
    .replace(/\[话题\]#/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 小红书正文里的空行是有意义的（分段靠它），所以按空行切段。 */
function paragraphs(text) {
  return cleanDesc(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function mediaBlock(rec) {
  const assets = rec.assets || [];
  // 站点原文（微信）的图片已经内嵌在 contentHtml 里了，不要再铺一遍
  const images = rec.contentHtml ? [] : assets.filter((a) => a.kind === 'image' && a.file);
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
  --rl-serif:"LiSong Pro","Apple LiSung","Songti SC","Source Han Serif SC",Georgia,serif;
  --rl-mono:"SF Mono","JetBrains Mono",ui-monospace,Menlo,monospace;
  --rl-size:18px; --rl-leading:1.9; --rl-measure:32rem;
  --rl-body-ink:#3f3a32;
}
@media (prefers-color-scheme: dark){
  :root{
    --rl-paper:#232324; --rl-paper-2:#1b1c1e;
    --rl-ink:#f9fafb; --rl-ink-soft:#cfd3d6; --rl-ink-faint:#81858c; --rl-body-ink:#d8dce0;
    --rl-line:rgba(255,255,255,.06); --rl-rule:rgba(255,255,255,.12);
    --rl-signal:#ff6363;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
/* 正文也用衬线：杂志的做法是"整页一个字体家族"，标题和正文只靠字号/字重分层 */
body{
  margin:0; background:var(--rl-paper); color:var(--rl-body-ink);
  font-family:var(--rl-serif);
  font-size:var(--rl-size); line-height:var(--rl-leading);
  letter-spacing:.02em;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
.rl-wrap{max-width:var(--rl-measure); margin:0 auto; padding:40px 30px 56px}

/* 刊头：眉标 → 题 → 元信息 → 署名线 */
.rl-body, .rl-content{
  font-variant-ligatures:common-ligatures;
}
.rl-kicker{
  display:flex; align-items:center; gap:8px; margin:0 0 14px;
  font-family:var(--rl-mono); font-size:10px; letter-spacing:.16em;
  color:var(--rl-ink-faint);
}
.rl-kicker i{width:5px; height:5px; background:var(--rl-signal); transform:rotate(45deg); flex:none}
h1{
  margin:0; font-family:var(--rl-serif); font-weight:500;
  font-size:1.72em; line-height:1.26; letter-spacing:-.006em; color:var(--rl-ink);
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

/* 正文：衬线 + 杂志密度（18px / 1.9 / 字距 +.02em） */
.rl-body{overflow-wrap:anywhere}
.rl-body p{margin:0 0 .92em}
.rl-body strong, .rl-body b{font-weight:600; color:var(--rl-ink)}
.rl-body p:last-child{margin-bottom:0}

.rl-tags{
  margin:22px 0 0; font-size:12.5px; color:var(--rl-ink-faint);
  display:flex; flex-wrap:wrap; gap:4px 10px;
}
.rl-tags a{color:inherit; text-decoration:none}

/* 站点原文（微信）：只补结构性规则，具体排版交给原文的 inline style */
.rl-content{font-size:var(--rl-size); line-height:var(--rl-leading); letter-spacing:.02em; overflow-wrap:anywhere}
.rl-content p{margin:0 0 .92em}
.rl-content strong, .rl-content b{font-weight:600; color:var(--rl-ink)}
.rl-content img{max-width:100%; height:auto; border-radius:6px; display:block; margin:18px auto}
.rl-content section{letter-spacing:inherit}
.rl-content blockquote{
  margin:1.4em 0; padding:2px 0 2px 16px; border-left:3px solid var(--rl-line);
  color:var(--rl-ink-faint);
}
.rl-content h1,.rl-content h2,.rl-content h3,.rl-content h4{
  font-family:var(--rl-serif); font-weight:500; color:var(--rl-ink);
  line-height:1.4; margin:1.6em 0 .6em;
}
.rl-content h2{font-size:1.32em; letter-spacing:-.004em}
.rl-content h3{font-size:1.12em} .rl-content h4{font-size:1em}
.rl-content ul,.rl-content ol{margin:0 0 1.05em; padding-left:1.4em}
.rl-content li{margin:.2em 0}
.rl-content a{color:var(--rl-signal); text-decoration:none; border-bottom:1px solid color-mix(in srgb, var(--rl-signal) 35%, transparent)}
.rl-content table{
  width:100%; border-collapse:collapse; margin:1.2em 0; font-size:.92em;
}
.rl-content th,.rl-content td{border:1px solid var(--rl-line); padding:6px 9px; text-align:left}
.rl-content th{background:var(--rl-paper-2); font-weight:500}
.rl-content pre{
  background:var(--rl-paper-2); border-radius:8px; padding:12px 14px;
  overflow-x:auto; font-family:var(--rl-mono); font-size:.86em; line-height:1.6;
}
.rl-content code{font-family:var(--rl-mono); font-size:.9em}
.rl-content hr{border:0; border-top:1px solid var(--rl-line); margin:1.8em 0}
.rl-content video{max-width:100%; border-radius:8px; display:block; margin:16px auto}

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
  const kicker = [site, author].filter(Boolean).join(' / ');
  // 元信息只留日期：地域和赞/藏/评是平台噪音，读的时候用不上
  const metaBits = [date].filter(Boolean);
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
  ${rec.contentHtml ? `<div class="rl-content">${rec.contentHtml}</div>` : `<div class="rl-body">${paragraphs(rec.desc)}</div>`}
  ${tags}
  <div class="rl-gallery">
  ${mediaBlock(rec)}
  </div>
  <p class="rl-src">来源 <a href="${escapeHtml(rec.url || '')}" target="_blank" rel="noreferrer">${escapeHtml(rec.url || '')}</a></p>
</div>
</body>
</html>`;
}
