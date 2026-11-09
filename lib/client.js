/**
 * 稍后阅读 — 浏览器半侧。
 *
 * 视觉跟随 ~/Code/dsh-panel-kit 的《自建面板设计规范》：
 *   同纸 · 同墨 · 同信号色 · 同刊头 · 同一套控制件几何（--pk-*）。
 * 版面语言按它是一个「待读堆 + 一页纸」来定：左边是剪报堆，右边是一张摊开的纸。
 *
 * 所有抓取与文件操作都在宿主半侧 /readlater/api/*，这里是纯 UI。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-readlater',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    const PANEL_ID = 'readlater';
    const API = '/readlater/api';

    /* ---------- 样式 ---------- */

    const CSS = `
/* @panel-kit:begin · 拷贝自 dsh-panel-kit/panel-kit.css（唯一来源），勿手改 */
.rl-root{
  --pk-control-h:34px; --pk-control-h-sm:28px; --pk-control-r:8px;
  --pk-control-px:13px; --pk-control-px-sm:10px;
  --pk-control-font:12.5px; --pk-control-font-sm:11.5px; --pk-control-gap:8px;
  --pk-toolbar-gap:10px;
  --pk-focus-width:2px; --pk-focus-offset:2px;
  --pk-ease:cubic-bezier(.2,.8,.2,1); --pk-fast:.15s;
}
/* @panel-kit:end */

/* 三层纸 · 两层墨 · 一支信号色（日版） */
.rl-root{
  --rl-paper:#faf6ee; --rl-card:#fffcf6; --rl-paper-2:#f1eadc; --rl-paper-3:#f5eee2;
  --rl-ink:#1b1813; --rl-ink-soft:#4b453a; --rl-ink-faint:#7f7666;
  --rl-line:rgba(27,24,19,.14); --rl-rule:rgba(27,24,19,.62);
  --rl-signal:#a8452f;
  --rl-serif:"LiSong Pro","Apple LiSung","Songti SC","Source Han Serif SC",Georgia,serif;
  --rl-mono:"SF Mono","JetBrains Mono",ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme: dark){
  .rl-root{
    --rl-paper:var(--dsw-alias-bg-base,#151517); --rl-card:#232324;
    --rl-paper-2:#1b1c1e; --rl-paper-3:#2c2c2e;
    --rl-ink:#f9fafb; --rl-ink-soft:#cfd3d6; --rl-ink-faint:#81858c;
    --rl-line:rgba(255,255,255,.06); --rl-rule:rgba(255,255,255,.12);
    --rl-signal:#ff6363;
  }
}

.rl-root{
  display:flex; flex-direction:column; height:100%; min-height:0;
  background:var(--rl-paper); color:var(--rl-ink-soft);
  font-family:-apple-system,"SF Pro Text","PingFang SC","Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.rl-root *{box-sizing:border-box}
.rl-root :focus-visible{
  outline:var(--pk-focus-width) solid var(--rl-signal);
  outline-offset:var(--pk-focus-offset); border-radius:4px;
}

/* ---------- 刊头 ---------- */
[data-platform=darwin] .rl-head{padding-top:calc(26px + var(--dsh-frame-top-clearance,0px))}
.rl-head{padding-top:30px; padding:30px 32px 20px; border-bottom:1px solid var(--rl-rule)}
.rl-head-row{display:flex; align-items:flex-end; justify-content:space-between; gap:32px}
.rl-brand{min-width:0}
.rl-eyebrow{
  display:flex; align-items:center; gap:9px; margin:0 0 10px;
  font-family:var(--rl-mono); font-size:10px; font-weight:500;
  letter-spacing:.18em; text-transform:uppercase; color:var(--rl-ink-faint);
}
.rl-mark{width:5px; height:5px; background:var(--rl-signal); transform:rotate(45deg); flex:none}
.rl-title{
  margin:0; font-family:var(--rl-serif); font-size:44px; font-weight:500;
  line-height:1.02; letter-spacing:-.022em; color:var(--rl-ink);
}
.rl-sub{margin:9px 0 0; font-size:14px; color:var(--rl-ink-faint); letter-spacing:.008em}
.rl-stamp{
  flex:none; text-align:right; font-family:var(--rl-mono); font-size:11px;
  color:var(--rl-ink-faint); letter-spacing:.017em; line-height:1.6;
}
.rl-stamp b{display:block; color:var(--rl-ink-soft); font-weight:500}
.rl-stamp .rl-busy{color:var(--rl-signal)}

/* ---------- 收件口 ---------- */
.rl-paste{
  display:flex; gap:var(--pk-control-gap);
  padding:16px 32px; border-bottom:1px solid var(--rl-line);
}
.rl-input{
  flex:1; min-width:0; height:var(--pk-control-h); padding:0 var(--pk-control-px);
  border:1px solid var(--rl-line); border-radius:var(--pk-control-r);
  background:var(--rl-card); color:var(--rl-ink); font:inherit;
  font-size:var(--pk-control-font); outline:none;
  transition:border-color var(--pk-fast) var(--pk-ease), box-shadow var(--pk-fast) var(--pk-ease);
}
.rl-input::placeholder{color:var(--rl-ink-faint)}
.rl-input:focus{border-color:var(--rl-signal); box-shadow:0 0 0 3px color-mix(in srgb, var(--rl-signal) 14%, transparent)}
.rl-input:disabled{background:var(--rl-paper-2); color:var(--rl-ink-faint)}

/* 按钮：一屏只有一个实心 */
.rl-btn{
  display:inline-flex; align-items:center; justify-content:center;
  height:var(--pk-control-h); padding:0 var(--pk-control-px);
  border:1px solid var(--rl-line); border-radius:var(--pk-control-r);
  background:var(--rl-card); color:var(--rl-ink-soft); font:inherit;
  font-size:var(--pk-control-font); font-weight:500; cursor:pointer; white-space:nowrap;
  transition:background var(--pk-fast) var(--pk-ease), border-color var(--pk-fast) var(--pk-ease),
             color var(--pk-fast) var(--pk-ease), transform var(--pk-fast) var(--pk-ease);
}
.rl-btn:hover{background:var(--rl-paper-3); border-color:var(--rl-line); color:var(--rl-ink)}
.rl-btn:active{transform:translateY(1px)}
.rl-btn:disabled{opacity:.45; cursor:default; transform:none}
.rl-btn--primary{
  background:var(--rl-ink); border-color:var(--rl-ink); color:var(--rl-paper);
}
.rl-btn--primary:hover{background:var(--rl-ink-soft); border-color:var(--rl-ink-soft); color:var(--rl-paper)}
.rl-btn--quiet{
  border-color:transparent; background:transparent; height:var(--pk-control-h-sm);
  font-size:var(--pk-control-font-sm); padding:0 var(--pk-control-px-sm);
  color:var(--rl-ink-faint);
}
.rl-btn--quiet:hover{background:var(--rl-paper-3); color:var(--rl-ink)}
.rl-btn--danger:hover{color:var(--rl-signal)}

.rl-hint{
  margin:0; padding:0 32px 12px; font-size:11.5px; letter-spacing:.01em;
  color:var(--rl-ink-faint); min-height:0;
}
.rl-hint--err{color:var(--rl-signal)}
.rl-hint b{font-weight:500; color:var(--rl-ink-soft)}

/* ---------- 主体 ---------- */
.rl-body{display:flex; flex:1; min-height:0; border-top:1px solid var(--rl-line)}
.rl-list{
  width:330px; flex:none; overflow-y:auto; padding:10px;
  border-right:1px solid var(--rl-line); scrollbar-gutter:stable;
}

.rl-card{
  position:relative; display:flex; gap:10px; padding:10px;
  border-radius:var(--pk-control-r); cursor:pointer;
  transition:background var(--pk-fast) var(--pk-ease), transform var(--pk-fast) var(--pk-ease);
}
.rl-card:hover{background:var(--rl-paper-3); transform:translateY(-1px)}
.rl-card:active{transform:translateY(0)}
.rl-card--on{background:var(--rl-paper-3)}
.rl-card--on::before{
  content:""; position:absolute; left:0; top:12px; bottom:12px;
  width:2px; border-radius:2px; background:var(--rl-signal);
}
.rl-thumb{
  width:56px; height:56px; flex:none; border-radius:var(--pk-control-r);
  object-fit:cover; background:var(--rl-paper-2); display:block;
}
.rl-thumb--empty{
  display:flex; align-items:center; justify-content:center;
  color:var(--rl-ink-faint); font-size:16px;
}
.rl-card-main{min-width:0; flex:1; padding-top:1px}
.rl-card-title{
  margin:0 0 5px; font-size:13px; line-height:1.45; font-weight:500;
  color:var(--rl-ink); display:-webkit-box; -webkit-line-clamp:2;
  -webkit-box-orient:vertical; overflow:hidden;
}
.rl-card-meta{
  margin:0; display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  font-size:11px; color:var(--rl-ink-faint); letter-spacing:.01em;
}
.rl-badge{
  border:1px solid var(--rl-line); border-radius:999px; padding:0 7px;
  font-size:10.5px; line-height:16px; color:var(--rl-ink-faint);
}
.rl-badge--signal{border-color:var(--rl-signal); color:var(--rl-signal)}
.rl-badge--ok{border-color:color-mix(in srgb, var(--rl-ink-faint) 40%, transparent); color:var(--rl-ink-faint)}

/* ---------- 阅读区 ---------- */
.rl-read{flex:1; min-width:0; display:flex; flex-direction:column; background:var(--rl-paper-2)}
.rl-read-head{
  display:flex; align-items:center; gap:var(--pk-toolbar-gap);
  height:46px; padding:0 14px; flex:none; border-bottom:1px solid var(--rl-line);
}
.rl-read-title{
  flex:1; min-width:0; font-size:12px; color:var(--rl-ink-faint);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; letter-spacing:.01em;
}
.rl-stage{flex:1; min-height:0; padding:14px 16px 16px}
.rl-frame{
  width:100%; height:100%; border:0; border-radius:var(--pk-control-r);
  background:var(--rl-card); display:block;
  box-shadow:0 0 0 1px var(--rl-line), 0 1px 2px rgba(27,24,19,.04);
}

/* ---------- 空态：一句话 + 一个出口 ---------- */
.rl-empty{
  flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:6px; padding:32px; text-align:center;
}
.rl-empty-title{margin:0; font-family:var(--rl-serif); font-size:19px; color:var(--rl-ink); letter-spacing:-.01em}
.rl-empty-note{margin:0; font-size:12.5px; line-height:1.7; color:var(--rl-ink-faint); max-width:30ch}
.rl-empty .rl-btn{margin-top:10px}

@media (max-width:900px){
  .rl-list{width:264px}
  .rl-title{font-size:34px}
  .rl-head{padding:24px 22px 16px}
  .rl-paste{padding:14px 22px}
  .rl-hint{padding:0 22px 10px}
}
@media (max-width:720px){
  .rl-body{flex-direction:column}
  .rl-list{width:auto; max-height:42%; border-right:0; border-bottom:1px solid var(--rl-line)}
  .rl-title{font-size:28px}
  .rl-head-row{gap:16px}
  .rl-stamp{display:none}
}
@media (prefers-reduced-motion: reduce){
  .rl-root *{transition:none!important; animation:none!important}
  .rl-card:hover{transform:none}
}
`;

    let styleEl = null;
    function mountCss() {
      if (styleEl) return;
      styleEl = document.createElement('style');
      styleEl.id = 'readlater-panel-css';
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
    }
    function unmountCss() {
      try {
        styleEl?.remove();
      } catch {
        /* 已卸载 */
      }
      styleEl = null;
    }

    /* ---------- 数据 ---------- */

    const bytes = (n) => {
      const v = Number(n) || 0;
      if (v < 1024) return v + ' B';
      if (v < 1024 * 1024) return Math.round(v / 1024) + ' KB';
      return (v / 1024 / 1024).toFixed(1) + ' MB';
    };

    const when = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const diff = (Date.now() - d.getTime()) / 86400000;
      if (diff < 1) return '今天';
      if (diff < 2) return '昨天';
      if (diff < 30) return `${Math.floor(diff)} 天前`;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    async function api(p, init) {
      const r = await fetch(API + p, init);
      const body = await r.json().catch(() => ({ ok: false, error: '返回不是 JSON' }));
      if (!r.ok || body.ok === false) throw new Error(body.error || `HTTP ${r.status}`);
      return body;
    }

    /* ---------- 组件 ---------- */

    function Card({ item, active, onPick }) {
      return h(
        'div',
        {
          className: 'rl-card' + (active ? ' rl-card--on' : ''),
          onClick: () => onPick(item.slug),
          role: 'button',
          tabIndex: 0,
          'aria-current': active ? 'true' : undefined,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onPick(item.slug);
            }
          },
        },
        item.thumb
          ? h('img', { className: 'rl-thumb', src: `${API}/asset/${item.slug}/${item.thumb}`, alt: '', loading: 'lazy' })
          : h('div', { className: 'rl-thumb rl-thumb--empty' }, item.layout === 'video' ? '▶' : '◍'),
        h(
          'div',
          { className: 'rl-card-main' },
          h('p', { className: 'rl-card-title' }, item.title || '(无标题)'),
          h(
            'p',
            { className: 'rl-card-meta' },
            h('span', null, when(item.saved)),
            item.author ? h('span', null, item.author) : null,
            item.layout === 'video' ? h('span', { className: 'rl-badge' }, '视频') : null,
            item.projectedAt
              ? h(
                  'span',
                  {
                    className:
                      'rl-badge' +
                      (item.contentHash && item.projectedHash && item.contentHash !== item.projectedHash
                        ? ' rl-badge--signal'
                        : ' rl-badge--ok'),
                  },
                  item.contentHash && item.projectedHash && item.contentHash !== item.projectedHash ? '有更新' : '已同步',
                )
              : null,
          ),
        ),
      );
    }

    function Reader({ slug, item, onRefresh, onDelete, onProject, onUnproject, onFocusInput, busy, syncing }) {
      if (!slug) {
        return h(
          'div',
          { className: 'rl-empty' },
          h('p', { className: 'rl-empty-title' }, '还没有待读的'),
          h('p', { className: 'rl-empty-note' }, '把小红书的分享链接粘到上面，链接会在这里落成一页纸。'),
          h('button', { className: 'rl-btn', onClick: onFocusInput }, '粘贴链接'),
        );
      }
      return h(
        'div',
        { className: 'rl-read' },
        h(
          'div',
          { className: 'rl-read-head' },
          h(
            'span',
            { className: 'rl-read-title' },
            `${item?.platformLabel || '链接'} · ${bytes(item?.mediaBytes)} · ${(item?.assetCount || 0)} 张图`,
          ),
          h(
            'button',
            { className: 'rl-btn rl-btn--quiet', onClick: () => onProject(slug), disabled: busy || syncing },
            syncing ? '同步中…' : item?.projectedAt ? '同步更新' : '同步到 Obsidian',
          ),
          item?.projectedAt
            ? h('button', { className: 'rl-btn rl-btn--quiet', onClick: () => onUnproject(slug), disabled: busy || syncing }, '撤销')
            : null,
          h('button', { className: 'rl-btn rl-btn--quiet', onClick: () => onRefresh(slug), disabled: busy }, '重新解析'),
          h('button', { className: 'rl-btn rl-btn--quiet rl-btn--danger', onClick: () => onDelete(slug, item?.title), disabled: busy }, '删除'),
        ),
        h(
          'div',
          { className: 'rl-stage' },
          h('iframe', { className: 'rl-frame', src: `${API}/view/${encodeURIComponent(slug)}`, title: item?.title || '阅读视图' }),
        ),
      );
    }

    function Main() {
      const [items, setItems] = useState([]);
      const [active, setActive] = useState(null);
      const [text, setText] = useState('');
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState('');
      const [info, setInfo] = useState('');
      const [syncing, setSyncing] = useState(false);
      const [queue, setQueue] = useState(null);
      const [root, setRoot] = useState('');
      const alive = useRef(true);
      const inputRef = useRef(null);

      const reload = useCallback(async () => {
        try {
          const [list, state] = await Promise.all([api('/list'), api('/state')]);
          if (!alive.current) return;
          setItems(list.items || []);
          setRoot(state.root || '');
          setQueue(state.queue || null);
        } catch (e) {
          if (alive.current) setErr(String(e.message || e));
        }
      }, []);

      useEffect(() => {
        alive.current = true;
        mountCss();
        reload();
        return () => {
          alive.current = false;
        };
      }, [reload]);

      useEffect(() => {
        if (!busy) return undefined;
        const t = setInterval(async () => {
          try {
            const s = await api('/state');
            if (alive.current) setQueue(s.queue || null);
          } catch {
            /* 轮询失败不打扰用户 */
          }
        }, 1500);
        return () => clearInterval(t);
      }, [busy]);

      const pick = useCallback((slug) => setActive(slug), []);
      const focusInput = useCallback(() => inputRef.current?.focus(), []);

      const submit = useCallback(async () => {
        const raw = text.trim();
        if (!raw) {
          setErr('先粘贴一条链接');
          inputRef.current?.focus();
          return;
        }
        setBusy(true);
        setErr('');
        setInfo('');
        try {
          const r = await api('/add', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: raw }),
          });
          if (alive.current) {
            setText('');
            setInfo(r.duplicate ? '这篇已经收藏过了' : '已保存到本地');
            setActive(r.record?.slug || null);
          }
          await reload();
        } catch (e) {
          if (alive.current) setErr(String(e.message || e));
          await reload();
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [text, reload]);

      const detach = useCallback(
        async (slug, title) => {
          if (!window.confirm(`删除《${title || slug}》？本地图片会一起删掉。`)) return;
          setBusy(true);
          try {
            await api('/delete', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ slug }),
            });
            if (alive.current) {
              setInfo('已删除');
              if (active === slug) setActive(null);
            }
            await reload();
          } catch (e) {
            if (alive.current) setErr(String(e.message || e));
          } finally {
            if (alive.current) setBusy(false);
          }
        },
        [active, reload],
      );

      const refresh = useCallback(
        async (slug) => {
          setBusy(true);
          setErr('');
          try {
            await api('/refresh', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ slug }),
            });
            if (alive.current) setInfo('已重新解析');
            await reload();
          } catch (e) {
            if (alive.current) setErr(String(e.message || e));
          } finally {
            if (alive.current) setBusy(false);
          }
        },
        [reload],
      );

      const project = useCallback(
        async (slug) => {
          setSyncing(true);
          setErr('');
          try {
            const r = await api('/project', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ slug }),
            });
            if (alive.current) {
              const name = String(r.file || '').split('/').pop();
              setInfo(`已同步到 Obsidian：${name}`);
            }
            await reload();
          } catch (e) {
            if (alive.current) setErr(String(e.message || e));
          } finally {
            if (alive.current) setSyncing(false);
          }
        },
        [reload],
      );

      const unproject = useCallback(
        async (slug) => {
          if (!window.confirm('从 Obsidian 撤下这一篇？本地库不受影响。')) return;
          setSyncing(true);
          try {
            await api('/unproject', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ slug }),
            });
            if (alive.current) setInfo('已从 Obsidian 撤下');
            await reload();
          } catch (e) {
            if (alive.current) setErr(String(e.message || e));
          } finally {
            if (alive.current) setSyncing(false);
          }
        },
        [reload],
      );

      const activeItem = useMemo(() => items.find((x) => x.slug === active) || null, [items, active]);
      // 计数与体积从列表算，不另存一份状态——两份数据迟早会漂
      const count = items.length;
      const totalBytes = useMemo(() => items.reduce((n, x) => n + (Number(x.mediaBytes) || 0), 0), [items]);
      const step = queue?.current?.step;

      const stamp = busy
        ? h('b', { className: 'rl-busy' }, step ? `解析中 · ${step}` : '解析中')
        : info
          ? h('b', null, info)
          : h('b', null, `${count} 篇`);

      return h(
        'div',
        { className: 'rl-root' },
        h(
          'header',
          { className: 'rl-head' },
          h(
            'div',
            { className: 'rl-head-row' },
            h(
              'div',
              { className: 'rl-brand' },
              h('p', { className: 'rl-eyebrow' }, h('i', { className: 'rl-mark' }), 'Local Clippings'),
              h('h1', { className: 'rl-title' }, '稍后阅读'),
              h('p', { className: 'rl-sub' }, '粘一条链接，落成本地的一页纸。不经过模型。'),
            ),
            h(
              'div',
              { className: 'rl-stamp' },
              stamp,
              h('span', null, count
                ? [bytes(totalBytes), root ? root.replace(/^\/Users\/[^/]+/, '~') : ''].filter(Boolean).join(' · ')
                : '本地库为空'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'rl-paste' },
          h('input', {
            ref: inputRef,
            className: 'rl-input',
            placeholder: '粘贴小红书分享链接，或整段分享文案…',
            value: text,
            disabled: busy,
            'aria-label': '粘贴分享链接',
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && !busy) submit();
            },
          }),
          h('button', { className: 'rl-btn rl-btn--primary', onClick: submit, disabled: busy }, busy ? '解析中' : '收藏'),
        ),
        err ? h('p', { className: 'rl-hint rl-hint--err' }, err) : null,
        h(
          'div',
          { className: 'rl-body' },
          h('div', { className: 'rl-list' }, items.map((it) => h(Card, { key: it.slug, item: it, active: it.slug === active, onPick: pick }))),
          h(Reader, {
            slug: active,
            item: activeItem,
            onRefresh: refresh,
            onDelete: detach,
            onProject: project,
            onUnproject: unproject,
            onFocusInput: focusInput,
            busy,
            syncing,
          }),
        ),
      );
    }

    function SidebarIcon() {
      return h(
        'span',
        { style: { display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center' } },
        h(
          'svg',
          { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          h('path', {
            d: 'M3 3.2A1.2 1.2 0 0 1 4.2 2h5.1L13 5.7v7.1A1.2 1.2 0 0 1 11.8 14H4.2A1.2 1.2 0 0 1 3 12.8V3.2Z',
            stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round',
          }),
          h('path', { d: 'M9 2v4h4', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }),
          h('path', { d: 'M5.6 9.2h4.8M5.6 11.4h3.2', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
        ),
      );
    }

    /* ---------- 插件体 ---------- */

    function apply(ctx) {
      try {
        mountCss();
        if (ctx.effect) ctx.effect(() => () => unmountCss(), 'readlater: styles');

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({}) }, Main),
        );

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 34, label: () => '稍后阅读' },
            SidebarIcon,
          ),
        );
      } catch (e) {
        console.error('[readlater] apply failed', e);
      }
    }

    exports.__test__ = { Card, Reader, Main, SidebarIcon, CSS, bytes, when };
    exports.PANEL_ID = PANEL_ID;
    exports.inject = ['slots'];
    exports.apply = apply;
    return module.exports;
  },
});
