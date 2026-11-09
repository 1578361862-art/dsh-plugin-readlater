/**
 * 无头 Chrome 的公共通道。
 *
 * 小红书和微信都需要真实的浏览器环境：
 *   - 小红书: 分享链之外一律风控，必须渲染后读 __INITIAL_STATE__
 *   - 微信:   纯 HTTP（任何 UA）都只拿到 secitptpage/verify 这个 JS 壳，
 *             必须让挑战脚本跑完才吐正文
 *
 * 用法是 withSession + open()，进程在一次任务结束时统一收掉，
 * 不在这里做"常驻浏览器"——串行队列下没必要，也少一类僵尸进程。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  if (process.env.READLATER_CHROME) return process.env.READLATER_CHROME;
  const candidates = [];
  const abRoot = path.join(os.homedir(), '.agent-browser/browsers');
  try {
    for (const d of fs.readdirSync(abRoot).filter((x) => x.startsWith('chrome-')).sort().reverse()) {
      candidates.push(path.join(abRoot, d, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
    }
  } catch {
    /* 没装 agent-browser 也正常 */
  }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error('找不到 Chrome；装一个，或设 READLATER_CHROME 指向可执行文件');
}

async function waitForCdp(port, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('Chrome 的调试端口没起来');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((resolve) => ws.addEventListener('open', resolve));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(JSON.stringify(m.error)));
      else p.res(m.result);
    }
  });
  /**
   * 每条 CDP 命令都必须有超时。
   * 踩过的坑：页面崩了/目标被替换时，命令永远等不到回包，
   * 整条解析链就静默挂住，队列后面全堵死。
   */
  const send = (method, params = {}, timeoutMs = 20000) =>
    new Promise((res, rej) => {
      const i = ++id;
      const timer = setTimeout(() => {
        pending.delete(i);
        rej(new Error(`CDP ${method} 超时 ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(i, {
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); },
      });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send, ready, close: () => ws.close() };
}

/**
 * 判断一个 user-data-dir 能不能用。
 *
 * Chrome 用 SingletonLock 这个符号链接做互斥：内容是 `<hostname>-<pid>`。
 * 两个坑：
 *   1. 进程被杀之后锁会留下，而且指向一个已经不存在的 pid —— Chrome 会直接
 *      "Aborting now to avoid profile corruption"，从此这个 profile 永久起不来；
 *   2. 悬空符号链接用 fs.existsSync 判断会返回 false（它跟随链接），
 *      所以必须 lstat 本体。
 */
function profileState(dir) {
  const lock = path.join(dir, 'SingletonLock');
  let target;
  try {
    target = fs.readlinkSync(lock);
  } catch {
    return 'free'; // 没有锁
  }
  const m = /^(.*)-(\d+)$/.exec(target);
  if (!m) return 'busy';
  const host = m[1];
  const pid = Number(m[2]);

  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (e) {
    alive = e && e.code === 'EPERM'; // 存在但无权限，算活着
  }

  if (host === os.hostname() && !alive) {
    // 本机、进程已死 → 这是一把死锁，可以安全回收
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
        /* 已经不在了 */
      }
    }
    return 'reclaimed';
  }
  return 'busy';
}

/**
 * 起一个临时 Chrome，交给 fn 用，结束时一定收掉。
 * @param {{profileDir?:string, log?:Function}} opts
 * @param {(session:{open:Function}) => Promise<any>} fn
 */
export async function withSession({ profileDir, log = () => {} } = {}, fn) {
  /**
   * 用哪个 profile 起 Chrome。第一次用调用方指定的（为了复用 cookie），
   * 起不来就换一个一次性的 —— 因为"上次被 kill 的 Chrome 还占着 user-data-dir"
   * 会让新进程直接委托给那个实例、永远不开调试端口，表现就是端口超时。
   */
  const candidates = [];
  if (profileDir && profileState(profileDir) !== 'busy') candidates.push(profileDir);
  candidates.push(path.join(os.tmpdir(), `readlater-chrome-${process.pid}-${Date.now()}`));

  let lastErr = null;
  for (const profile of candidates) {
    try {
      return await runSession(profile, fn, log);
    } catch (err) {
      lastErr = err;
      if (profile !== candidates[candidates.length - 1]) {
        log(`用 ${path.basename(profile)} 起不来（${err?.message || err}），换一次性 profile 重试`);
      }
    }
  }
  throw lastErr || new Error('Chrome 起不来');
}

async function runSession(profile, fn, log) {
  const chromePath = findChrome();
  const port = await freePort();
  fs.mkdirSync(profile, { recursive: true });

  log(`chrome: ${path.basename(chromePath)} · port ${port}`);
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      // DSH 沙箱下这些是硬要求，否则 Chrome 起不来
      '--no-sandbox', '--disable-gpu', '--disable-crashpad', '--crash-dumps-dir=/tmp',
      `--user-data-dir=${profile}`,
      '--use-mock-keychain',
      '--disable-blink-features=AutomationControlled',
      '--disable-background-networking', '--disable-sync',
      '--no-first-run', '--no-default-browser-check', '--mute-audio',
      '--window-size=1440,900',
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    await waitForCdp(port);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const t = targets.find((x) => x.type === 'page');
    if (!t) throw new Error('Chrome 没有可用的标签页');
    const page = cdp(t.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable', {}, 10000);
    await page.send('Runtime.enable', {}, 10000);

    const session = {
      async open(url, { ua, acceptLanguage = 'zh-CN,zh;q=0.9', platform = 'MacIntel' } = {}) {
        if (ua) await page.send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage, platform });
        await page.send('Page.navigate', { url }, 20000);
      },
      /** 在页面里求值，返回可序列化的结果。 */
      async evaluate(expression) {
        const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, 20000);
        return r.result?.value;
      },
      /** 轮询直到表达式为真；返回最后一次的结果。 */
      async waitFor(expression, { timeoutMs = 30000, intervalMs = 1000 } = {}) {
        const deadline = Date.now() + timeoutMs;
        let last;
        while (Date.now() < deadline) {
          await sleep(intervalMs);
          try {
            last = await session.evaluate(expression);
          } catch (err) {
            // 页面还在换文档时求值会失败，这不算终局，继续等
            if (/超时/.test(String(err?.message))) throw err;
            last = null;
          }
          if (last) return last;
        }
        return null;
      },
      /** 当前页面的序列化 DOM（含 JS 渲染后的结果）。 */
      async dom() {
        return session.evaluate('document.documentElement.outerHTML');
      },
      url: () => session.evaluate('location.href'),
      title: () => session.evaluate('document.title'),
    };
    return await fn(session);
  } finally {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 已经退了 */
    }
  }
}
