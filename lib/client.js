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
:root {
  /* 控制件：一个面板里所有可点的矩形（按钮、下拉、搜索框）共用一套高度 */
  --pk-control-h: 34px;         /* 常规按钮 / 下拉 / 搜索框 */
  --pk-control-h-sm: 28px;      /* 行内小按钮、表单里的 chip */
  --pk-control-r: 8px;          /* 圆角：三块面板统一 8，不再各写 6/7/9 */
  --pk-control-px: 13px;        /* 左右内边距 */
  --pk-control-px-sm: 10px;
  --pk-control-font: 12.5px;
  --pk-control-font-sm: 11.5px;
  --pk-control-gap: 8px;        /* 相邻控制件之间 */

  /* 页签：同一页面切换视图（总览 / 对照 / 持仓…），下划线式 */
  --pk-tab-h: 38px;
  --pk-tab-gap: 26px;
  --pk-tab-font: 14px;
  --pk-tab-underline: 2px;

  /* 分段控件：同一位置切换取值（今日/本周/本月、卡片/列表） */
  --pk-seg-h: 34px;
  --pk-seg-item-h: 28px;
  --pk-seg-r: 9px;
  --pk-seg-item-r: 6px;
  --pk-seg-pad: 3px;
  --pk-seg-gap: 2px;

  /* 工具条：一行里搜索 + 筛选 + 视图 */
  --pk-toolbar-gap: 10px;

  /* 焦点：键盘可见，统一 2px 外扩 2px */
  --pk-focus-width: 2px;
  --pk-focus-offset: 2px;

  /* 动效 */
  --pk-ease: cubic-bezier(.2, .8, .2, 1);
  --pk-fast: .15s;
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
.rl-root :focus-visible:not(input):not(textarea):not(select){
  outline:var(--pk-focus-width) solid var(--rl-signal);
  outline-offset:var(--pk-focus-offset); border-radius:4px;
}
/* 输入框获得焦点时不画框：光标本身就够了 */
.rl-root input:focus, .rl-root textarea:focus{outline:none; box-shadow:none}

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
.rl-input:focus{border-color:var(--rl-line); box-shadow:none}
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


/* ---------- 工具条 / 筛选 / 多选 ---------- */
.rl-list{display:flex; flex-direction:column; overflow:hidden; padding:10px 10px 0}
.rl-tools{display:flex; gap:6px; align-items:center; padding-bottom:8px; flex:none}
.rl-search{
  flex:1; min-width:0; height:var(--pk-control-h-sm); padding:0 var(--pk-control-px-sm);
  border:1px solid var(--rl-line); border-radius:var(--pk-control-r);
  background:var(--rl-card); color:var(--rl-ink); font:inherit;
  font-size:var(--pk-control-font-sm); outline:none;
  transition:border-color var(--pk-fast) var(--pk-ease);
}
.rl-search::placeholder{color:var(--rl-ink-faint)}
.rl-search:focus{border-color:var(--rl-line); box-shadow:none}
.rl-btn--on{background:var(--rl-paper-3); color:var(--rl-ink); border-color:var(--rl-line)}

.rl-chips{display:flex; gap:6px; flex-wrap:wrap; padding-bottom:8px; flex:none}
.rl-chip{
  height:22px; padding:0 9px; border:1px solid transparent; border-radius:999px;
  background:transparent; color:var(--rl-ink-faint); font:inherit; font-size:11px;
  cursor:pointer; transition:background var(--pk-fast) var(--pk-ease), color var(--pk-fast) var(--pk-ease);
}
.rl-chip:hover{background:var(--rl-paper-3); color:var(--rl-ink-soft)}
.rl-chip--on{background:var(--rl-paper-3); border-color:var(--rl-line); color:var(--rl-ink)}

.rl-scroll{flex:1; min-height:0; overflow-y:auto; padding-bottom:10px; scrollbar-gutter:stable}
.rl-none{margin:0; padding:26px 8px; text-align:center; font-size:12px; color:var(--rl-ink-faint)}

.rl-tick{
  width:16px; height:16px; flex:none; margin-top:20px; border-radius:4px;
  border:1px solid var(--rl-line); background:var(--rl-card);
  display:flex; align-items:center; justify-content:center;
  font-size:10px; color:var(--rl-paper); line-height:1;
}
.rl-tick--on{background:var(--rl-ink); border-color:var(--rl-ink); color:var(--rl-paper)}
.rl-card--checked{background:var(--rl-paper-3)}

.rl-batch{
  position:sticky; bottom:0; display:flex; align-items:center; gap:8px;
  margin-top:6px; padding:8px 2px; background:var(--rl-paper);
  border-top:1px solid var(--rl-line);
}
.rl-batch-count{flex:1; text-align:right; font-size:11px; color:var(--rl-ink-faint)}

.rl-hintbar{display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 32px 10px}
.rl-toggle{display:inline-flex; align-items:center; gap:6px; font-size:11px; color:var(--rl-ink-faint); cursor:pointer; white-space:nowrap}
.rl-toggle input{width:13px; height:13px; accent-color:var(--rl-ink); margin:0}

/* ---------- 主体 ---------- */
.rl-body{display:flex; flex:1; min-height:0; border-top:1px solid var(--rl-line)}
.rl-list{
  width:330px; flex:none;
  border-right:1px solid var(--rl-line);
}

.rl-card{
  position:relative; display:flex; gap:10px; padding:10px;
  border-radius:var(--pk-control-r); cursor:pointer;
  transition:background var(--pk-fast) var(--pk-ease), transform var(--pk-fast) var(--pk-ease);
}
.rl-card:hover{background:var(--rl-paper-3); transform:translateY(-1px)}
.rl-card:active{transform:translateY(0)}
.rl-card--on{background:var(--rl-paper-3)}
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

/* ---------- 标签条 ---------- */
.rl-tagbar{
  display:flex; align-items:center; gap:6px; flex-wrap:wrap; flex:none;
  padding:8px 14px; border-bottom:1px solid var(--rl-line);
  background:var(--rl-paper-2);
}
.rl-tagchip{
  display:inline-flex; align-items:center; gap:5px; height:22px; padding:0 8px;
  border-radius:999px; background:var(--rl-card); border:1px solid var(--rl-line);
  font-size:11px; color:var(--rl-ink-soft); letter-spacing:.01em;
}
.rl-tagchip button{
  border:0; background:transparent; color:var(--rl-ink-faint); cursor:pointer;
  font-size:13px; line-height:1; padding:0 0 0 1px;
}
.rl-tagchip button:hover{color:var(--rl-signal)}
.rl-tagempty{font-size:11px; color:var(--rl-ink-faint)}
.rl-tagadd{
  height:22px; padding:0 8px; border:1px dashed var(--rl-line); border-radius:999px;
  background:transparent; color:var(--rl-ink-faint); font:inherit; font-size:11px; cursor:pointer;
}
.rl-tagadd:hover{border-color:var(--rl-ink-faint); color:var(--rl-ink-soft)}
.rl-taginput{
  height:22px; width:108px; padding:0 8px; border:1px solid var(--rl-line);
  border-radius:999px; background:var(--rl-card); color:var(--rl-ink);
  font:inherit; font-size:11px; outline:none;
}
.rl-taginput:focus{border-color:var(--rl-line)}

/* ---------- 任务指示器 ---------- */
.rl-root{position:relative}
.rl-headright{display:flex; align-items:center; gap:14px; flex:none; position:relative}
.rl-jobs{
  display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 9px;
  border:1px solid var(--rl-line); border-radius:999px; background:var(--rl-card);
  color:var(--rl-ink-soft); font:inherit; font-size:11.5px; cursor:pointer;
  transition:background var(--pk-fast) var(--pk-ease);
}
.rl-jobs:hover{background:var(--rl-paper-3)}
.rl-jobs[aria-expanded=true]{background:var(--rl-paper-3); border-color:var(--rl-ink-faint)}
.rl-jobs--run{color:var(--rl-signal); border-color:color-mix(in srgb, var(--rl-signal) 45%, transparent)}
.rl-spin{animation:rl-spin 2.4s linear infinite}
@keyframes rl-spin{to{transform:rotate(360deg)}}
.rl-ok{font-size:11px}
.rl-jobpop{
  position:absolute; top:calc(100% + 8px); right:0; z-index:6; width:306px;
  background:var(--rl-card); border:1px solid var(--rl-line); border-radius:var(--pk-control-r);
  box-shadow:0 12px 28px -12px rgba(0,0,0,.45); padding:11px 13px; text-align:left;
}
.rl-jp-title{margin:0 0 8px; font-size:11.5px; color:var(--rl-ink-faint)}
.rl-jp-empty{margin:6px 0; font-size:11.5px; color:var(--rl-ink-faint)}
.rl-jobpop ul{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px}
.rl-jobpop li{display:flex; gap:9px; align-items:flex-start}
.rl-jobpop li.is-done{opacity:.55}
.rl-jobpop b{display:block; font-size:12px; font-weight:500; color:var(--rl-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:236px}
.rl-jobpop li span{font-size:11px; color:var(--rl-ink-faint)}
.rl-jobpop i{width:10px; height:10px; margin-top:4px; flex:none; border-radius:50%; border:1.5px solid var(--rl-line)}
.rl-jobpop i.spin{border-top-color:var(--rl-signal); animation:rl-spin .9s linear infinite}
.rl-jobpop i.ok{border-color:var(--rl-signal); background:var(--rl-signal)}
.rl-jobpop i.wait{background:var(--rl-paper-3)}
.rl-jp-foot{margin:10px 0 0; padding-top:9px; border-top:1px solid var(--rl-line); font-size:11px; color:var(--rl-ink-faint)}

/* ---------- 完成提示 ---------- */
.rl-toast{
  position:absolute; right:20px; bottom:18px; z-index:7; max-width:min(420px, 70%);
  display:flex; flex-direction:column; gap:2px; padding:10px 13px;
  background:var(--rl-ink); color:var(--rl-paper); border-radius:9px;
  box-shadow:0 14px 30px -14px rgba(0,0,0,.6);
  animation:rl-rise .22s var(--pk-ease);
}
@keyframes rl-rise{from{opacity:0; transform:translateY(8px)} to{opacity:1; transform:none}}
.rl-toast span{font-size:11px; opacity:.7}
.rl-toast b{font-size:12px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}

/* ---------- 行内选择 ---------- */
/* 选择模式：对勾从左侧滑入，方块整体右移让位 */
.rl-card{padding-left:10px; transition:padding-left .18s var(--pk-ease), background var(--pk-fast) var(--pk-ease)}
.rl-list--sel .rl-card{padding-left:36px}
.rl-pick{
  position:absolute; left:10px; top:50%;
  display:flex; align-items:center;
  opacity:0; transform:translateY(-50%) translateX(-8px);
  pointer-events:none;
  transition:opacity .16s var(--pk-ease), transform .18s var(--pk-ease);
}
.rl-list--sel .rl-pick{opacity:1; transform:translateY(-50%) translateX(0); pointer-events:auto}
.rl-pick input{width:14px; height:14px; margin:0; accent-color:var(--rl-ink); cursor:pointer}
@media (prefers-reduced-motion: reduce){
  .rl-card, .rl-pick{transition:none}
}
.rl-selbar{display:flex; align-items:center; gap:6px; padding:0 2px 8px; flex:none}
.rl-selall{display:inline-flex; align-items:center; gap:6px; font-size:11.5px; color:var(--rl-ink-soft); cursor:pointer; white-space:nowrap}
.rl-selall input{width:14px; height:14px; margin:0; accent-color:var(--rl-ink)}
.rl-selall b{color:var(--rl-ink); font-weight:500}
.rl-grow{flex:1}
.rl-x{border:0; background:transparent; color:var(--rl-ink-faint); cursor:pointer; font:inherit; font-size:13px; line-height:1; padding:0 0 0 8px}
.rl-x:hover{color:var(--rl-ink)}

/* ---------- 编辑器 ---------- */
.rl-editor{flex:1; min-height:0; display:flex; flex-direction:column; background:var(--rl-paper-2)}
.rl-ed-head{padding:8px 16px; border-bottom:1px solid var(--rl-line); flex:none}
.rl-ed-hint{margin:0; font-size:11px; color:var(--rl-ink-faint); letter-spacing:.01em}
.rl-ed-title{
  margin:12px 16px 4px; height:38px; padding:0 12px; flex:none;
  border:1px solid var(--rl-line); border-radius:var(--pk-control-r);
  background:var(--rl-card); color:var(--rl-ink);
  font-family:var(--rl-serif); font-size:17px; outline:none;
}
.rl-ed-title:focus{border-color:var(--rl-line)}
.rl-ed-body{flex:1; min-height:0; overflow-y:auto; padding:8px 16px 16px}
.rl-ed-block{
  margin-bottom:10px; padding:8px; border-radius:var(--pk-control-r);
  background:var(--rl-card); border:1px solid var(--rl-line);
}
.rl-ed-block-head{display:flex; align-items:center; gap:8px; margin-bottom:6px}
.rl-ed-type{
  height:22px; padding:0 6px; border:1px solid var(--rl-line); border-radius:6px;
  background:var(--rl-paper-3); color:var(--rl-ink-soft); font:inherit; font-size:11px; cursor:pointer;
}
.rl-ed-actions{margin-left:auto; display:flex; gap:2px}
.rl-ed-text{
  width:100%; padding:6px 8px; border:1px solid transparent; border-radius:6px;
  background:transparent; color:var(--rl-ink-soft); font:inherit;
  font-family:var(--rl-serif); font-size:13px; line-height:1.7; resize:vertical; outline:none;
}
.rl-ed-text:hover{background:var(--rl-paper-3)}
.rl-ed-text:focus{background:var(--rl-card); border-color:var(--rl-line)}
.rl-ed-img{
  display:flex; align-items:center; gap:10px; margin-bottom:10px; padding:8px;
  border-radius:var(--pk-control-r); background:var(--rl-card); border:1px solid var(--rl-line);
}
.rl-ed-img img{
  width:72px; height:72px; flex:none; object-fit:cover; border-radius:6px; background:var(--rl-paper-2);
}
.rl-ed-img-name{flex:1; min-width:0; font-family:var(--rl-mono); font-size:10.5px; color:var(--rl-ink-faint); overflow:hidden; text-overflow:ellipsis}
.rl-ed-foot{
  display:flex; align-items:center; gap:8px; flex:none;
  padding:10px 16px; border-top:1px solid var(--rl-line); background:var(--rl-paper-2);
}
.rl-ed-grow{flex:1}

/* ---------- 空态：一句话 + 一个出口 ---------- */
.rl-empty{
  flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:6px; padding:32px; text-align:center;
}
.rl-empty-title{margin:0; font-family:var(--rl-serif); font-size:19px; color:var(--rl-ink); letter-spacing:-.01em}
.rl-empty-note{margin:0; font-size:12.5px; line-height:1.7; color:var(--rl-ink-faint); max-width:30ch}
.rl-empty .rl-btn{margin-top:10px}

@media (max-width:820px){
  /* 窄屏的批量条：计数让位给按钮本身（按钮文案里已经带数字） */
  .rl-batch{gap:6px}
  .rl-batch-count{display:none}
  .rl-batch .rl-btn{padding:0 8px; font-size:11px}
  .rl-batch .rl-btn--quiet{padding:0 6px}
}
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

    const isDirty = (it) =>
      !!(it.projectedAt && it.contentHash && it.projectedHash && it.contentHash !== it.projectedHash);

    /**
     * 列表的搜索与筛选。抽成纯函数是为了能单测——
     * 这段逻辑藏在渲染里的话，只能靠肉眼点。
     */
    function filterItems(items, q, filter) {
      const needle = String(q || '').trim().toLowerCase();
      return (items || []).filter((it) => {
        if (filter === 'unread' && it.status !== 'unread') return false;
        if (filter === 'synced' && !it.projectedAt) return false;
        if (filter === 'dirty' && !isDirty(it)) return false;
        if (!needle) return true;
        const hay = [it.title, it.author, it.siteName, it.snippet, (it.tags || []).join(' ')]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      });
    }

    async function api(p, init) {
      const r = await fetch(API + p, init);
      const body = await r.json().catch(() => ({ ok: false, error: '返回不是 JSON' }));
      if (!r.ok || body.ok === false) throw new Error(body.error || `HTTP ${r.status}`);
      return body;
    }

    /* ---------- 组件 ---------- */

    function Card({ item, active, onPick, checked, onToggle, selMode }) {
      const activate = () => (selMode ? onToggle(item.slug) : onPick(item.slug));
      return h(
        'div',
        {
          className: 'rl-card' + (active ? ' rl-card--on' : '') + (checked ? ' rl-card--checked' : ''),
          onClick: activate,
          role: 'button',
          tabIndex: 0,
          'aria-current': active ? 'true' : undefined,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              activate();
            }
          },
        },
        h(
          'span',
          { className: 'rl-pick', onClick: (e) => e.stopPropagation() },
          h('input', {
            type: 'checkbox',
            checked: !!checked,
            'aria-label': `选择 ${item.title || ''}`,
            onChange: () => onToggle(item.slug),
          }),
        ),
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

    /** 标签条：点 × 删，点「+ 标签」输入回车加。改完立刻落盘（已投影的会同步重投）。 */
    function TagStrip({ item, onChange }) {
      const [adding, setAdding] = useState(false);
      const [draft, setDraft] = useState('');
      if (!item) return null;
      const tags = item.tags || [];

      const commit = (next) => {
        onChange(next);
        setAdding(false);
        setDraft('');
      };

      return h(
        'div',
        { className: 'rl-tagbar' },
        tags.length
          ? tags.map((t) =>
              h(
                'span',
                { className: 'rl-tagchip', key: t },
                h('span', null, `#${t}`),
                h(
                  'button',
                  {
                    type: 'button',
                    'aria-label': `移除标签 ${t}`,
                    onClick: () => commit(tags.filter((x) => x !== t)),
                  },
                  '×',
                ),
              ),
            )
          : h('span', { className: 'rl-tagempty' }, '还没有标签'),
        adding
          ? h('input', {
              className: 'rl-taginput',
              autoFocus: true,
              value: draft,
              placeholder: '回车添加',
              'aria-label': '新标签',
              onChange: (e) => setDraft(e.target.value),
              onBlur: () => {
                if (draft.trim()) commit([...tags, draft.trim()]);
                else setAdding(false);
              },
              onKeyDown: (e) => {
                if (e.key === 'Enter' && draft.trim()) commit([...tags, draft.trim()]);
                if (e.key === 'Escape') {
                  setAdding(false);
                  setDraft('');
                }
              },
            })
          : h(
              'button',
              { className: 'rl-tagadd', type: 'button', onClick: () => setAdding(true) },
              '+ 标签',
            ),
      );
    }

    const TYPE_LABEL = { p: '正文', h: '小标题', quote: '引用', img: '图片' };

    /** 块编辑器：删图、改字、调顺序、改标题。 */
    function Editor({ slug, draft, setDraft, onSave, onCancel, onReset, saving, layout }) {
      if (!draft) return h('div', { className: 'rl-empty' }, h('p', { className: 'rl-empty-note' }, '正在读取内容…'));
      const blocks = draft.blocks || [];

      const patch = (i, next) => {
        const list = blocks.slice();
        list[i] = next;
        setDraft({ ...draft, blocks: list });
      };
      const move = (i, dir) => {
        const j = i + dir;
        if (j < 0 || j >= blocks.length) return;
        const list = blocks.slice();
        [list[i], list[j]] = [list[j], list[i]];
        setDraft({ ...draft, blocks: list });
      };
      const remove = (i) => {
        const list = blocks.slice();
        list.splice(i, 1);
        setDraft({ ...draft, blocks: list });
      };
      const addText = () => {
        setDraft({ ...draft, blocks: [...blocks, { type: 'p', text: '' }] });
      };

      return h(
        'div',
        { className: 'rl-editor' },
        h(
          'div',
          { className: 'rl-ed-head' },
          h('span', { className: 'rl-ed-hint' },
            layout === 'article'
              ? '长文第一次编辑会把格式压平成段落/标题/引用，加粗颜色等样式会丢。'
              : '改完保存即生效；已同步的会顺手更新 Obsidian。'),
        ),
        h('input', {
          className: 'rl-ed-title',
          value: draft.title || '',
          'aria-label': '标题',
          onChange: (e) => setDraft({ ...draft, title: e.target.value }),
        }),
        h(
          'div',
          { className: 'rl-ed-body' },
          blocks.map((b, i) => {
            if (b.type === 'img') {
              return h(
                'div',
                { className: 'rl-ed-img', key: i },
                h('img', { src: `${API}/asset/${slug}/${b.file}`, alt: '', loading: 'lazy' }),
                h('span', { className: 'rl-ed-img-name' }, b.file),
                h('div', { className: 'rl-ed-actions' },
                  h('button', { type: 'button', className: 'rl-btn rl-btn--quiet', onClick: () => move(i, -1) }, '↑'),
                  h('button', { type: 'button', className: 'rl-btn rl-btn--quiet', onClick: () => move(i, 1) }, '↓'),
                  h('button', { type: 'button', className: 'rl-btn rl-btn--quiet rl-btn--danger', onClick: () => remove(i) }, '删除'),
                ),
              );
            }
            return h(
              'div',
              { className: 'rl-ed-block', key: i },
              h(
                'div',
                { className: 'rl-ed-block-head' },
                h(
                  'select',
                  {
                    className: 'rl-ed-type',
                    value: b.type,
                    'aria-label': '块类型',
                    onChange: (e) => patch(i, { ...b, type: e.target.value }),
                  },
                  ['p', 'h', 'quote'].map((t) => h('option', { key: t, value: t }, TYPE_LABEL[t])),
                ),
                h('div', { className: 'rl-ed-actions' },
                  h('button', { type: 'button', className: 'rl-btn rl-btn--quiet', onClick: () => move(i, -1) }, '↑'),
                  h('button', { type: 'button', className: 'rl-btn rl-btn--quiet', onClick: () => move(i, 1) }, '↓'),
                  h('button', { type: 'button', className: 'rl-btn rl-btn--quiet rl-btn--danger', onClick: () => remove(i) }, '删除'),
                ),
              ),
              h('textarea', {
                className: 'rl-ed-text',
                value: b.text || '',
                rows: Math.max(2, Math.min(12, Math.ceil(String(b.text || '').length / 26) + 1)),
                'aria-label': TYPE_LABEL[b.type],
                onChange: (e) => patch(i, { ...b, text: e.target.value }),
              }),
            );
          }),
        ),
        h(
          'div',
          { className: 'rl-ed-foot' },
          h('button', { type: 'button', className: 'rl-btn rl-btn--quiet', onClick: addText }, '+ 段落'),
          h(
            'button',
            {
              type: 'button',
              className: 'rl-btn rl-btn--quiet',
              onClick: () => setDraft({ ...draft, blocks: blocks.filter((b) => b.type !== 'img') }),
            },
            '清空图片',
          ),
          h('span', { className: 'rl-ed-grow' }),
          h('button', { type: 'button', className: 'rl-btn rl-btn--quiet rl-btn--danger', onClick: onReset, disabled: saving }, '还原原文'),
          h('button', { type: 'button', className: 'rl-btn', onClick: onCancel, disabled: saving }, '取消'),
          h('button', { type: 'button', className: 'rl-btn rl-btn--primary', onClick: onSave, disabled: saving }, saving ? '保存中…' : '保存'),
        ),
      );
    }

    function Reader({ slug, item, onRefresh, onDelete, onProject, onUnproject, onTags, onFocusInput, busy, syncing,
      editing, draft, setDraft, onStartEdit, onCancelEdit, onSaveEdit, onResetEdit, saving }) {
      if (!slug) {
        return h(
          'div',
          { className: 'rl-empty' },
          h('p', { className: 'rl-empty-title' }, '还没有待读的'),
          h('p', { className: 'rl-empty-note' }, '把小红书的分享链接粘到上面，链接会在这里落成一页纸。'),
          h('button', { className: 'rl-btn', onClick: onFocusInput }, '粘贴链接'),
        );
      }
      if (editing) {
        return h(
          'div',
          { className: 'rl-read' },
          h(
            'div',
            { className: 'rl-read-head' },
            h('span', { className: 'rl-read-title' }, '编辑 · 保存后立刻生效'),
            h('button', { className: 'rl-btn rl-btn--quiet', onClick: onCancelEdit }, '返回阅读'),
          ),
          h(Editor, {
            slug,
            draft,
            setDraft,
            onSave: onSaveEdit,
            onCancel: onCancelEdit,
            onReset: onResetEdit,
            saving,
            layout: item?.layout,
          }),
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
          h('button', { className: 'rl-btn rl-btn--quiet', onClick: () => onStartEdit(slug), disabled: busy || syncing }, item?.edited ? '编辑（已改）' : '编辑'),
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
        h(TagStrip, { item, onChange: (next) => onTags(slug, next) }),
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
      const [q, setQ] = useState('');
      const [filter, setFilter] = useState('all');
      const [selected, setSelected] = useState(null);
      const [video, setVideo] = useState(() => {
        try {
          return typeof localStorage !== 'undefined' && localStorage.getItem('readlater:video') === '1';
        } catch {
          return false;
        }
      });
      const [text, setText] = useState('');
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState('');
      const [info, setInfo] = useState('');
      const [syncing, setSyncing] = useState(false);
      const [jobs, setJobs] = useState([]);
      const [jobStats, setJobStats] = useState(null);
      const [openJobs, setOpenJobs] = useState(false);
      const [toast, setToast] = useState(null);
      const [editing, setEditing] = useState(null);
      const [draft, setDraft] = useState(null);
      const [saving, setSaving] = useState(false);
      const [queue, setQueue] = useState(null);
      const [root, setRoot] = useState('');
      const [cool, setCool] = useState(null);
      const [selMode, setSelMode] = useState(false);
      const alive = useRef(true);
      const inputRef = useRef(null);

      const reload = useCallback(async () => {
        try {
          const [list, state] = await Promise.all([api('/list'), api('/state')]);
          if (!alive.current) return;
          setItems(list.items || []);
          setRoot(state.root || '');
          setQueue(state.queue || null);
          setCool(state.throttle || null);
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

      // 任务轮询：既驱动"处理中"指示器，也负责在完成时弹一次提示
      const seenDone = useRef(new Set());
      useEffect(() => {
        let stop = false;
        const tick = async () => {
          try {
            const s = await api('/state');
            if (stop || !alive.current) return;
            setQueue(s.queue || null);
            setJobs(s.jobs || []);
            setJobStats(s.jobStats || null);
            setCool(s.throttle || null);
            const fresh = (s.jobs || []).filter(
              (j) => j.status === 'done' && !seenDone.current.has(j.id),
            );
            for (const j of fresh) seenDone.current.add(j.id);
            if (fresh.length === 1) setInfo(`已收藏 · ${fresh[0].title || fresh[0].label}`);
            else if (fresh.length > 1) setInfo(`已完成 ${fresh.length} 项`);
            if (fresh.length) await reload();
          } catch {
            /* 轮询失败不打扰用户 */
          }
        };
        tick();
        const t = setInterval(tick, 2500);
        return () => {
          stop = true;
          clearInterval(t);
        };
      }, [reload]);

      const pick = useCallback((slug) => setActive(slug), []);
      const focusInput = useCallback(() => inputRef.current?.focus(), []);

      const visible = useMemo(() => filterItems(items, q, filter), [items, q, filter]);

      const sel = selected || new Set();
      const toggleSel = useCallback((slug) => {
        setSelected((prev) => {
          const next = new Set(prev || []);
          if (next.has(slug)) next.delete(slug);
          else next.add(slug);
          return next;
        });
      }, []);
      const selectAllVisible = useCallback(() => {
        setSelected(new Set(visible.map((v) => v.slug)));
      }, [visible]);
      const clearSel = useCallback(() => {
        setSelected(new Set());
      }, []);

      const exitSel = useCallback(() => {
        setSelected(new Set());
        setSelMode(false);
      }, []);

      const syncBatch = useCallback(
        async (slugs) => {
          const list = Array.isArray(slugs) ? slugs : [...sel];
          if (!list.length) {
            setErr('先选几篇');
            return;
          }
          setSyncing(true);
          setErr('');
          try {
            const r = await api('/project-batch', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ slugs: list }),
            });
            if (alive.current) {
              const ok = (r.done || []).length;
              const bad = (r.failed || []).length;
              setInfo(bad ? `已同步 ${ok} 篇，${bad} 篇失败` : `已同步 ${ok} 篇到 Obsidian`);
            }
            await reload();
          } catch (e) {
            if (alive.current) setErr(String(e.message || e));
          } finally {
            if (alive.current) {
              setSyncing(false);
              setSelected(new Set());
            }
          }
        },
        [reload, sel],
      );

      const batchTag = useCallback(async () => {
        const list = [...sel];
        if (!list.length) return;
        const name = window.prompt(`给选中的 ${list.length} 篇加一个标签`);
        const tag = String(name || '').trim();
        if (!tag) return;
        setSyncing(true);
        setErr('');
        try {
          const r = await api('/tags-batch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slugs: list, add: [tag] }),
          });
          if (alive.current) setInfo(`已给 ${r.changed} 篇加上「${tag}」`);
          await reload();
        } catch (e) {
          if (alive.current) setErr(String(e.message || e));
        } finally {
          if (alive.current) setSyncing(false);
        }
      }, [reload, sel]);

      const deleteBatch = useCallback(async () => {
        const list = [...sel];
        if (!list.length) {
          setErr('先选几篇');
          return;
        }
        const projected = list.filter((s) => items.find((x) => x.slug === s)?.projectedAt).length;
        const extra = projected ? `\n其中 ${projected} 篇已同步，Obsidian 那边也会一起撤下。` : '';
        if (!window.confirm(`删除选中的 ${list.length} 篇？本地图片会一起删掉。${extra}`)) return;
        setSyncing(true);
        setErr('');
        try {
          const r = await api('/delete-batch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slugs: list }),
          });
          if (alive.current) {
            setInfo(`已删除 ${r.deleted} 篇${r.unprojected ? `，并撤下 ${r.unprojected} 篇投影` : ''}`);
            setSelected(new Set());
            setActive(null);
          }
          await reload();
        } catch (e) {
          if (alive.current) setErr(String(e.message || e));
        } finally {
          if (alive.current) setSyncing(false);
        }
      }, [items, reload, sel]);

      const toggleVideo = useCallback(() => {
        setVideo((prev) => {
          const next = !prev;
          try {
            if (typeof localStorage !== 'undefined') localStorage.setItem('readlater:video', next ? '1' : '0');
          } catch {
            /* 存不了就只管这一次 */
          }
          return next;
        });
      }, []);

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
            body: JSON.stringify({ text: raw, video }),
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
      }, [text, video, reload]);

      const detach = useCallback(
        async (slug, title) => {
          const wasProjected = items.find((x) => x.slug === slug)?.projectedAt;
          const extra = wasProjected ? '\n它已同步到 Obsidian，那边也会一起撤下。' : '';
          if (!window.confirm(`删除《${title || slug}》？本地图片会一起删掉。${extra}`)) return;
          setBusy(true);
          try {
            await api('/delete', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ slug }),
            });
            if (alive.current) {
              setInfo(wasProjected ? '已删除，并从 Obsidian 撤下' : '已删除');
              if (active === slug) setActive(null);
            }
            await reload();
          } catch (e) {
            if (alive.current) setErr(String(e.message || e));
          } finally {
            if (alive.current) setBusy(false);
          }
        },
        [active, reload, items],
      );

      const refresh = useCallback(
        async (slug) => {
          const edited = (items.find((x) => x.slug === slug) || {}).edited;
          if (edited && !window.confirm('这篇你编辑过，重新解析会丢弃编辑。继续？')) return;
          setBusy(true);
          setErr('');
          try {
            await api('/refresh', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ slug, discardEdits: !!edited }),
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

      const saveTags = useCallback(
        async (slug, tags) => {
          try {
            const r = await api('/tags', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ slug, tags }),
            });
            if (alive.current) setInfo(r.reprojected ? '标签已保存，Obsidian 已同步' : '标签已保存');
            await reload();
          } catch (e) {
            if (alive.current) setErr(String(e.message || e));
          }
        },
        [reload],
      );

      useEffect(() => {
        if (!info) return undefined;
        setToast({ title: info });
        const t = setTimeout(() => {
          setToast(null);
          setInfo('');
        }, 4200);
        return () => clearTimeout(t);
      }, [info]);

      const startEdit = useCallback(async (slug) => {
        setErr('');
        try {
          const r = await api(`/blocks?slug=${encodeURIComponent(slug)}`);
          setDraft({ title: r.title || '', blocks: r.blocks || [] });
          setEditing(slug);
          if (r.derived) setInfo('长文的格式已压平成段落，保存前可以再调整');
        } catch (e) {
          if (alive.current) setErr(String(e.message || e));
        }
      }, []);

      const saveEdit = useCallback(async () => {
        if (!editing || !draft) return;
        setSaving(true);
        setErr('');
        try {
          const r = await api('/blocks', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slug: editing, blocks: draft.blocks, title: draft.title }),
          });
          if (alive.current) {
            setInfo(r.reprojected ? '已保存，Obsidian 已同步' : '已保存');
            setEditing(null);
            setDraft(null);
          }
          await reload();
        } catch (e) {
          if (alive.current) setErr(String(e.message || e));
        } finally {
          if (alive.current) setSaving(false);
        }
      }, [draft, editing, reload]);

      const resetEdit = useCallback(async () => {
        if (!editing) return;
        if (!window.confirm('还原成解析时的原文？你的编辑会丢失。')) return;
        setSaving(true);
        try {
          await api('/blocks/reset', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slug: editing }),
          });
          const r = await api(`/blocks?slug=${encodeURIComponent(editing)}`);
          if (alive.current) {
            setDraft({ title: r.title || '', blocks: r.blocks || [] });
            setInfo('已还原为原文');
          }
        } catch (e) {
          if (alive.current) setErr(String(e.message || e));
        } finally {
          if (alive.current) setSaving(false);
        }
      }, [editing]);

      const jobsActive = (jobStats?.running || 0) + (jobStats?.queued || 0);
      const activeItem = useMemo(() => items.find((x) => x.slug === active) || null, [items, active]);
      // 计数与体积从列表算，不另存一份状态——两份数据迟早会漂
      const count = items.length;
      const totalBytes = useMemo(() => items.reduce((n, x) => n + (Number(x.mediaBytes) || 0), 0), [items]);
      const step = queue?.current?.step;
      // 提示条：报错/进度/最近一次动作，占位不跳动（始终渲染同一行）
      const hint = busy
        ? step
          ? `正在解析：${step}…`
          : '正在解析…'
        : info ||
          (cool && cool.cooling
            ? `微信冷却中 · 还剩 ${cool.remainsText}（连续请求会被判环境异常）`
            : count
              ? ''
              : '粘一条链接，回车即可收藏。');

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
              { className: 'rl-headright' },
              jobsActive > 0 || jobStats?.done
                ? h(
                    'button',
                    {
                      className: 'rl-jobs' + (jobsActive > 0 ? ' rl-jobs--run' : ''),
                      'aria-expanded': openJobs,
                      'aria-controls': 'rl-jobpop',
                      onClick: () => setOpenJobs((v) => !v),
                      title: jobsActive > 0 ? `${jobsActive} 项处理中` : `${jobStats?.done || 0} 项刚完成`,
                    },
                    jobsActive > 0
                      ? h(
                          'svg',
                          { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', className: 'rl-spin' },
                          h('circle', {
                            cx: 8, cy: 8, r: 6, stroke: 'currentColor', strokeWidth: 1.6,
                            strokeDasharray: '26 12', strokeLinecap: 'round',
                          }),
                        )
                      : h('span', { className: 'rl-ok', 'aria-hidden': 'true' }, '✓'),
                    h('span', null, String(jobsActive || jobStats?.done || 0)),
                  )
                : null,
              h(
                'div',
                { className: 'rl-stamp' },
                h('b', null, `${count} 篇`),
                h('span', null, count
                  ? [bytes(totalBytes), root ? root.replace(/^\/Users\/[^/]+/, '~') : ''].filter(Boolean).join(' · ')
                  : '本地库为空'),
              ),
              openJobs
                ? h(
                    'div',
                    { className: 'rl-jobpop', id: 'rl-jobpop', role: 'dialog', 'aria-label': '处理中的链接' },
                    h(
                      'p',
                      { className: 'rl-jp-title' },
                      jobsActive ? `正在处理 ${jobsActive} 项` : '刚刚完成',
                    ),
                    jobs.length
                      ? h(
                          'ul',
                          null,
                          jobs
                            .filter((j) => j.status === 'running' || j.status === 'queued' || j.status === 'done')
                            .slice(-8)
                            .map((j) =>
                              h(
                                'li',
                                { key: j.id, className: j.status === 'done' ? 'is-done' : '' },
                                h('i', { className: j.status === 'running' ? 'spin' : j.status === 'done' ? 'ok' : 'wait' }),
                                h(
                                  'div',
                                  null,
                                  h('b', null, j.title || j.label),
                                  h('span', null, j.status === 'running' ? j.step || '处理中' : j.status === 'done' ? '完成' : j.step || '排队中'),
                                ),
                              ),
                            ),
                        )
                      : h('p', { className: 'rl-jp-empty' }, '没有正在处理的任务'),
                    h('p', { className: 'rl-jp-foot' }, '完成后会自动提示，不用等在这里。'),
                  )
                : null,
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
        h(
          'div',
          { className: 'rl-hintbar' },
          err
            ? h(
                'p',
                { className: 'rl-hint rl-hint--err' },
                err,
                h('button', { type: 'button', className: 'rl-x', onClick: () => setErr(''), 'aria-label': '关闭' }, '×'),
              )
            : h('span', null),
          h(
            'label',
            { className: 'rl-toggle', title: '开启后，视频会一起下载到本地（体积较大）' },
            h('input', { type: 'checkbox', checked: video, onChange: toggleVideo }),
            h('span', null, '缓存视频'),
          ),
        ),
        h(
          'div',
          { className: 'rl-body' },
          h(
            'div',
            { className: 'rl-list' + (selMode ? ' rl-list--sel' : '') },
            h(
              'div',
              { className: 'rl-tools' },
              h('input', {
                className: 'rl-search',
                placeholder: '搜标题、作者、正文…',
                value: q,
                'aria-label': '搜索收藏',
                onChange: (e) => setQ(e.target.value),
              }),
              h(
                'button',
                {
                  className: 'rl-btn rl-btn--quiet' + (selMode ? ' rl-btn--on' : ''),
                  'aria-pressed': selMode,
                  onClick: () => (selMode ? exitSel() : setSelMode(true)),
                },
                selMode ? '完成' : '选择',
              ),
            ),
            selMode
              ? h(
                  'div',
                  { className: 'rl-selbar' },
                  h(
                    'label',
                    { className: 'rl-selall' },
                    h('input', {
                      type: 'checkbox',
                      checked: sel.size > 0 && sel.size === visible.length,
                      ref: (el) => {
                        if (el) el.indeterminate = sel.size > 0 && sel.size < visible.length;
                      },
                      onChange: (e) => (e.target.checked ? selectAllVisible() : clearSel()),
                      'aria-label': '全选',
                    }),
                    h('span', null, sel.size ? '已选 ' : '全选 '),
                    h('b', null, sel.size ? String(sel.size) : String(visible.length)),
                  ),
                  h('span', { className: 'rl-grow' }),
                  h('button', { className: 'rl-btn rl-btn--sm', onClick: batchTag, disabled: syncing }, '标签'),
                  h('button', { className: 'rl-btn rl-btn--sm', onClick: () => syncBatch(), disabled: syncing }, '同步'),
                  h('button', { className: 'rl-btn rl-btn--sm rl-btn--danger', onClick: deleteBatch, disabled: syncing }, '删除'),
                  h('button', { className: 'rl-btn rl-btn--sm rl-btn--quiet', onClick: exitSel }, '取消'),
                )
              : h(
                  'div',
                  { className: 'rl-chips' },
                  [['all', '全部'], ['unread', '未读'], ['synced', '已同步'], ['dirty', '有更新']].map(([id, label]) =>
                    h(
                      'button',
                      {
                        key: id,
                        className: 'rl-chip' + (filter === id ? ' rl-chip--on' : ''),
                        'aria-pressed': filter === id,
                        onClick: () => setFilter(id),
                      },
                      label,
                    ),
                  ),
                ),
            h(
              'div',
              { className: 'rl-scroll' },
              visible.length === 0
                ? h(
                    'p',
                    { className: 'rl-none' },
                    q.trim() ? '没搜到。换个词试试。' : filter === 'all' ? '还没有收藏。' : '这一档是空的。',
                  )
                : null,
              visible.map((it) =>
                h(Card, {
                  key: it.slug,
                  item: it,
                  active: it.slug === active,
                  onPick: pick,
                  checked: sel.has(it.slug),
                  onToggle: toggleSel,
                  selMode,
                }),
              ),
            ),
          ),
          toast
            ? h(
                'div',
                { className: 'rl-toast is-on', role: 'status', 'aria-live': 'polite' },
                h('span', null, '已完成'),
                h('b', null, toast.title),
              )
            : null,
          h(Reader, {
            slug: active,
            item: activeItem,
            onRefresh: refresh,
            onDelete: detach,
            onProject: project,
            onUnproject: unproject,
            onTags: saveTags,
            editing: editing === active,
            draft,
            setDraft,
            onStartEdit: startEdit,
            onCancelEdit: () => {
              setEditing(null);
              setDraft(null);
            },
            onSaveEdit: saveEdit,
            onResetEdit: resetEdit,
            saving,
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

    exports.__test__ = { Card, Reader, Main, SidebarIcon, CSS, bytes, when, filterItems, isDirty };
    exports.PANEL_ID = PANEL_ID;
    exports.inject = ['slots'];
    exports.apply = apply;
    return module.exports;
  },
});
