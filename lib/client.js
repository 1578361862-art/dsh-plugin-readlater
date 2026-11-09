/**
 * 稍后阅读 — 浏览器半侧。
 *
 * 一个全局面板（main 槽 + 侧栏入口）：粘贴分享链接 → 本地解析 → 图文卡片阅读。
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
/* 控制件尺寸与另外几块面板对齐（值同 panel-kit，尚未纳入 check.mjs 跟踪） */
.rl-root{
  --pk-control-h:34px; --pk-control-h-sm:28px; --pk-control-r:8px;
  --pk-control-px:13px; --pk-control-px-sm:10px;
  --pk-control-font:12.5px; --pk-control-font-sm:11.5px; --pk-control-gap:8px;

  --rl-paper:#fbf9f5; --rl-ink:#1f1d1a; --rl-dim:#6f675d;
  --rl-line:#e6e0d6; --rl-chip:#efe9df; --rl-card:#fffdfa;
  display:flex; flex-direction:column; height:100%; min-height:0;
  background:var(--bg, #f7f5f1); color:var(--fg, #1f1d1a);
  font-size:13px;
}
@media (prefers-color-scheme: dark){
  .rl-root{ --rl-paper:#1b1a20; --rl-ink:#e8e4dc; --rl-dim:#9a9389;
            --rl-line:#2b2930; --rl-chip:#26242c; --rl-card:#1f1e25; }
}
.rl-top{
  display:flex; flex-direction:column; gap:10px;
  padding:16px 18px 12px; border-bottom:1px solid var(--rl-line);
}
.rl-title{ display:flex; align-items:baseline; gap:10px; }
.rl-title h1{ margin:0; font-size:15px; font-weight:600; letter-spacing:.01em; }
.rl-title span{ color:var(--rl-dim); font-size:11.5px; }
.rl-paste{ display:flex; gap:var(--pk-control-gap); }
.rl-input{
  flex:1; min-width:0; height:var(--pk-control-h); padding:0 var(--pk-control-px);
  border:1px solid var(--rl-line); border-radius:var(--pk-control-r);
  background:var(--rl-card); color:inherit; font:inherit; font-size:var(--pk-control-font);
  outline:none;
}
.rl-input:focus{ border-color:#c9bda8; box-shadow:0 0 0 2px rgba(180,160,120,.14); }
.rl-input::placeholder{ color:var(--rl-dim); }
.rl-btn{
  height:var(--pk-control-h); padding:0 var(--pk-control-px);
  border:1px solid var(--rl-line); border-radius:var(--pk-control-r);
  background:var(--rl-card); color:inherit; font:inherit; font-size:var(--pk-control-font);
  cursor:pointer; white-space:nowrap;
}
.rl-btn:hover{ background:var(--rl-chip); }
.rl-btn:disabled{ opacity:.5; cursor:default; }
.rl-btn--primary{ background:#2c2a27; color:#fdfbf7; border-color:#2c2a27; }
.rl-btn--primary:hover{ background:#3a3733; }
.rl-btn--sm{ height:var(--pk-control-h-sm); font-size:var(--pk-control-font-sm); padding:0 var(--pk-control-px-sm); }
.rl-btn--ghost{ border-color:transparent; background:transparent; }
.rl-btn--ghost:hover{ background:var(--rl-chip); }
.rl-note{ margin:0; font-size:11.5px; color:var(--rl-dim); line-height:1.6; }
.rl-note--err{ color:#b4453a; }
.rl-body{ display:flex; flex:1; min-height:0; }
.rl-list{
  width:320px; flex:none; overflow-y:auto; border-right:1px solid var(--rl-line);
  padding:8px;
}
.rl-card{
  display:flex; gap:10px; padding:8px; border-radius:10px; cursor:pointer;
  border:1px solid transparent;
}
.rl-card:hover{ background:var(--rl-chip); }
.rl-card--on{ background:var(--rl-chip); border-color:var(--rl-line); }
.rl-thumb{
  width:52px; height:52px; flex:none; border-radius:8px; object-fit:cover;
  background:var(--rl-chip); display:block;
}
.rl-thumb--empty{ display:flex; align-items:center; justify-content:center; font-size:18px; color:var(--rl-dim); }
.rl-card-main{ min-width:0; flex:1; }
.rl-card-title{
  margin:0 0 3px; font-size:12.5px; line-height:1.45; font-weight:500;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
}
.rl-card-meta{ margin:0; font-size:11px; color:var(--rl-dim); display:flex; gap:6px; flex-wrap:wrap; }
.rl-badge{ background:var(--rl-chip); border-radius:999px; padding:0 6px; }
.rl-read{
  flex:1; min-width:0; display:flex; flex-direction:column;
  background:var(--rl-paper); position:relative;
}
.rl-read-head{
  display:flex; align-items:center; gap:8px; padding:8px 12px;
  border-bottom:1px solid var(--rl-line); flex:none;
}
.rl-read-head .rl-grow{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--rl-dim); font-size:11.5px; }
.rl-frame{ flex:1; width:100%; border:0; background:transparent; }
.rl-empty{
  flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:8px; color:var(--rl-dim); font-size:12px; text-align:center; padding:24px;
}
.rl-empty b{ color:var(--rl-ink); font-weight:600; font-size:13px; }
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
      if (diff < 30) return Math.floor(diff) + ' 天前';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    async function api(p, init) {
      const r = await fetch(API + p, init);
      const body = await r.json().catch(() => ({ ok: false, error: '返回不是 JSON' }));
      if (!r.ok || body.ok === false) throw new Error(body.error || `HTTP ${r.status}`);
      return body;
    }

    /* ---------- 视图 ---------- */

    function Card({ item, active, onPick }) {
      const isVideo = item.layout === 'video';
      return h(
        'div',
        {
          className: 'rl-card' + (active ? ' rl-card--on' : ''),
          onClick: () => onPick(item.slug),
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') onPick(item.slug);
          },
        },
        item.thumb
          ? h('img', { className: 'rl-thumb', src: `${API}/asset/${item.slug}/${item.thumb}`, alt: '', loading: 'lazy' })
          : h('div', { className: 'rl-thumb rl-thumb--empty' }, isVideo ? '▶' : '◎'),
        h(
          'div',
          { className: 'rl-card-main' },
          h('p', { className: 'rl-card-title' }, item.title || '(无标题)'),
          h(
            'p',
            { className: 'rl-card-meta' },
            h('span', null, when(item.saved)),
            item.author ? h('span', null, item.author) : null,
            isVideo ? h('span', { className: 'rl-badge' }, '视频') : null,
            !item.projectedAt ? h('span', { className: 'rl-badge' }, '本地') : null,
          ),
        ),
      );
    }

    function Reader({ slug, item, onRefresh, onDelete, busy }) {
      if (!slug) {
        return h(
          'div',
          { className: 'rl-empty' },
          h('b', null, '左边还没有内容'),
          h('span', null, '把小红书的分享链接（或整段分享文案）粘到上面的输入框里。'),
          h('span', null, '链接会被本地解析，图片一并缓存，不经过任何模型。'),
        );
      }
      const src = `${API}/view/${encodeURIComponent(slug)}`;
      return h(
        'div',
        { className: 'rl-read' },
        h(
          'div',
          { className: 'rl-read-head' },
          h('span', { className: 'rl-grow' }, item ? `${item.platformLabel || item.platform} · ${bytes(item.mediaBytes)}` : ''),
          h('button', { className: 'rl-btn rl-btn--sm rl-btn--ghost', onClick: () => onRefresh(slug), disabled: busy }, '重新解析'),
          h('button', { className: 'rl-btn rl-btn--sm rl-btn--ghost', onClick: () => onDelete(slug, item?.title), disabled: busy }, '删除'),
        ),
        h('iframe', { className: 'rl-frame', src, title: item?.title || '阅读视图' }),
      );
    }

    function Main() {
      const [items, setItems] = useState([]);
      const [active, setActive] = useState(null);
      const [text, setText] = useState('');
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState('');
      const [info, setInfo] = useState('');
      const [queue, setQueue] = useState(null);
      const [root, setRoot] = useState('');
      const [count, setCount] = useState(0);
      const alive = useRef(true);
      const inputRef = useRef(null);

      const reload = useCallback(async () => {
        try {
          const [list, state] = await Promise.all([api('/list'), api('/state')]);
          if (!alive.current) return;
          setItems(list.items || []);
          setRoot(state.root || '');
          setCount(state.count || 0);
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

      // 解析是串行的，面板靠轮询拿进度
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

      const submit = useCallback(async () => {
        const raw = text.trim();
        if (!raw) {
          setErr('先粘贴一条链接');
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
            if (r.duplicate) setInfo('这篇已经收藏过了');
            else setInfo('已保存到本地');
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

      const activeItem = useMemo(() => items.find((x) => x.slug === active) || null, [items, active]);
      const step = queue?.current?.step;
      const hint = busy
        ? step
          ? `正在解析：${step}…`
          : '正在解析…'
        : info || (count ? `${count} 篇 · 数据在 ${root.replace(/^\/Users\/[^/]+/, '~')}` : '');

      return h(
        'div',
        { className: 'rl-root' },
        h(
          'div',
          { className: 'rl-top' },
          h(
            'div',
            { className: 'rl-title' },
            h('h1', null, '稍后阅读'),
            h('span', null, '本地解析 · 不经过模型'),
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
              onChange: (e) => setText(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !busy) submit();
              },
            }),
            h('button', { className: 'rl-btn rl-btn--primary', onClick: submit, disabled: busy }, busy ? '解析中' : '收藏'),
          ),
          err
            ? h('p', { className: 'rl-note rl-note--err' }, err)
            : hint
              ? h('p', { className: 'rl-note' }, hint)
              : null,
        ),
        h('div', { className: 'rl-body' }, h('div', { className: 'rl-list' }, items.map((it) => h(Card, { key: it.slug, item: it, active: it.slug === active, onPick: pick }))), h(Reader, { slug: active, item: activeItem, onRefresh: refresh, onDelete: detach, busy })),
      );
    }

    function SidebarIcon() {
      return h(
        'span',
        { style: { display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center' } },
        h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          h('path', {
            d: 'M3 3.2A1.2 1.2 0 0 1 4.2 2h5.1L13 5.7v7.1A1.2 1.2 0 0 1 11.8 14H4.2A1.2 1.2 0 0 1 3 12.8V3.2Z',
            stroke: 'currentColor',
            strokeWidth: '1.3',
            strokeLinejoin: 'round',
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
          ctx.slots.register(
            { name: 'main', key: PANEL_ID, inject: () => ({}) },
            Main,
          ),
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

    exports.__test__ = { Card, Reader, bytes, when };
    exports.PANEL_ID = PANEL_ID;
    exports.inject = ['slots'];
    exports.apply = apply;
    return module.exports;
  },
});
