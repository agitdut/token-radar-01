// Dev-only screenshot runner for token-radar-01 (not part of the graded entry).
// Serves a built output dir, drives headless Chromium over CDP, captures 3 JPEG
// screenshots (board / detail / filtered) at 1280x800 into repo screenshots/.
// Usage: node main.ts --input input/snapshot.json --output /tmp/radar-out1
//        node shots.mjs /tmp/radar-out1 [quality]
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const require = createRequire(import.meta.url);
const WebSocket = require('/home/hatch/workspace/makefun/agent-key/node_modules/ws');
const outDir = process.argv[2] || '/tmp/radar-out1';
const quality = Number(process.argv[3] || 82);
const repo = '/home/hatch/workspace/makefun/token-radar-01';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

const server = createServer((req, res) => {
  const path = join(outDir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!existsSync(path) || !path.startsWith(outDir)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const pending = new Map();
let nextId = 0, errors = [];
let browser, socket;
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression) {
  const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
function jpegDims(b) {
  if (b.readUInt16BE(0) !== 0xffd8) throw new Error('Not JPEG');
  for (let p = 2; p < b.length;) {
    if (b[p++] !== 0xff) throw new Error('Invalid JPEG marker');
    while (b[p] === 0xff) p++;
    const marker = b[p++], length = b.readUInt16BE(p);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return { width: b.readUInt16BE(p + 5), height: b.readUInt16BE(p + 3) };
    p += length;
  }
  throw new Error('JPEG dimensions missing');
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const done = once(child, 'exit');
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 2000).unref?.();
  await done;
}

try {
  const tmp = await mkdir('/tmp/radar-shots-profile', { recursive: true });
  browser = spawn('/home/hatch/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell', [
    '--no-sandbox', '--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--window-size=1440,900',
    '--user-data-dir=/tmp/radar-shots-profile', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserLog = '';
  browser.stderr.on('data', (b) => { browserLog += b; });
  let endpoint;
  for (let i = 0; !(endpoint = browserLog.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]); i++) {
    if (i > 150 || browser.exitCode !== null) throw new Error('Browser failed: ' + browserLog.slice(-500));
    await delay(100);
  }
  const debugOrigin = 'http://' + new URL(endpoint).host;
  const targets = await (await fetch(debugOrigin + '/json/list')).json();
  socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id) {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id); clearTimeout(entry.timer);
      msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown' ||
      (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') ||
      (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')) {
      errors.push({ method: msg.method, ...msg.params });
    }
  });
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Log.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const base = `http://127.0.0.1:${port}/dashboard/index.html`;
  async function shot(name, setup) {
    errors = [];
    const nav = await command('Page.navigate', { url: base });
    if (nav.errorText) throw new Error(nav.errorText);
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (await evalJs(`window.__radarReady === true`)) { ready = true; break; }
      await delay(100);
    }
    if (!ready) throw new Error('Page not ready: ' + name);
    if (setup) await evalJs(setup);
    await evalJs(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    await delay(300);
    const { data } = await command('Page.captureScreenshot', { format: 'jpeg', quality, fromSurface: true, captureBeyondViewport: false });
    const buf = Buffer.from(data, 'base64');
    await writeFile(join(repo, 'screenshots', name), buf);
    const dims = jpegDims(buf);
    const rowCount = await evalJs(`document.querySelectorAll('#rows tr').length`);
    console.log(JSON.stringify({ name, bytes: buf.length, ...dims, rows: rowCount, consoleErrors: errors.length, errors: errors.slice(0, 2) }));
    if (buf.length > 524288) throw new Error(`Screenshot over 512 KiB: ${name} (${buf.length})`);
    if (dims.width !== 1440 || dims.height !== 900) throw new Error(`Wrong dimensions: ${name}`);
    if (errors.length) throw new Error(`Console errors on ${name}: ${JSON.stringify(errors).slice(0, 500)}`);
    return buf.length;
  }

  await mkdir(join(repo, 'screenshots'), { recursive: true });
  // 1. Board view (default render, sorted by implied value).
  await shot('1-board.jpg');
  // 2. Detail view: open the top-ranked protocol's dialog.
  await shot('2-detail.jpg', `document.querySelector('#rows tr[data-slug]').click(); document.querySelector('#detail').open`);
  // 3. Filtered view: watchlist-only filter applied.
  await shot('3-filtered.jpg', `document.querySelector('#watch').checked = true; document.querySelector('#watch').dispatchEvent(new Event('change', {bubbles:true})); document.querySelector('#result-count').textContent`);
  console.log('SHOTS OK quality=' + quality);
} finally {
  socket?.close();
  await stop(browser);
  server.close();
}
