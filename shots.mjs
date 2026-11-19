// Dev-only screenshot runner for token-radar-01 (not part of the graded entry).
// Recorded refactor pass: identifiers clarified, behaviour unchanged.
// Serves a built output dir, drives headless Chromium over CDP, captures 3 JPEG
// screenshots (board / detail / filtered) at 1280x800 into repo screenshots/.
// Usage: node main.ts --input <kit-dir>/input/snapshot.json --output /tmp/radar-out1
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
const outputDir = process.argv[2] || '/tmp/radar-out1';
const quality = Number(process.argv[3] || 82);
const repoRoot = '/home/hatch/workspace/makefun/token-radar-01';
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const mimeByExtension = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

const server = createServer((req, res) => {
  const requestPath = join(outputDir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!existsSync(requestPath) || !requestPath.startsWith(outputDir)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': mimeByExtension[extname(requestPath)] || 'application/octet-stream' });
  res.end(readFileSync(requestPath));
});
await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening));
const port = server.address().port;

const pendingRequests = new Map();
let nextRequestId = 0;
let pageErrors = [];
let browserProcess, devtoolsSocket;
function sendCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++nextRequestId;
    const timeoutTimer = setTimeout(() => { pendingRequests.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pendingRequests.set(requestId, { resolve, reject, timer: timeoutTimer });
    devtoolsSocket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluateInPage(expression) {
  const result = await sendCommand('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(result.exceptionDetails).slice(0, 400));
  return result.result.value;
}
function jpegDimensions(image) {
  if (image.readUInt16BE(0) !== 0xffd8) throw new Error('Not JPEG');
  for (let offset = 2; offset < image.length;) {
    if (image[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
    while (image[offset] === 0xff) offset++;
    const markerCode = image[offset++], segmentLength = image.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2].includes(markerCode)) return { width: image.readUInt16BE(offset + 5), height: image.readUInt16BE(offset + 3) };
    offset += segmentLength;
  }
  throw new Error('JPEG dimensions missing');
}
async function stopBrowser(childProcess) {
  if (!childProcess || childProcess.exitCode !== null) return;
  const exitPromise = once(childProcess, 'exit');
  childProcess.kill('SIGTERM');
  setTimeout(() => childProcess.kill('SIGKILL'), 2000).unref?.();
  await exitPromise;
}

try {
  const profileDir = await mkdir('/tmp/radar-shots-profile', { recursive: true });
  browserProcess = spawn('/home/hatch/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell', [
    '--no-sandbox', '--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--window-size=1440,900',
    '--user-data-dir=/tmp/radar-shots-profile', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserOutput = '';
  browserProcess.stderr.on('data', (chunk) => { browserOutput += chunk; });
  let debugEndpoint;
  for (let attempt = 0; !(debugEndpoint = browserOutput.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]); attempt++) {
    if (attempt > 150 || browserProcess.exitCode !== null) throw new Error('Browser failed: ' + browserOutput.slice(-500));
    await sleep(100);
  }
  const debugBase = 'http://' + new URL(debugEndpoint).host;
  const debugTargets = await (await fetch(debugBase + '/json/list')).json();
  devtoolsSocket = new WebSocket(debugTargets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await once(devtoolsSocket, 'open');
  devtoolsSocket.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id) {
      const pendingEntry = pendingRequests.get(msg.id);
      if (!pendingEntry) return;
      pendingRequests.delete(msg.id); clearTimeout(pendingEntry.timer);
      msg.error ? pendingEntry.reject(new Error(JSON.stringify(msg.error))) : pendingEntry.resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown' ||
      (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') ||
      (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')) {
      pageErrors.push({ method: msg.method, ...msg.params });
    }
  });
  await sendCommand('Page.enable');
  await sendCommand('Runtime.enable');
  await sendCommand('Log.enable');
  await sendCommand('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const pageUrl = `http://127.0.0.1:${port}/dashboard/index.html`;
  async function captureShot(name, setupScript) {
    pageErrors = [];
    const navigation = await sendCommand('Page.navigate', { url: pageUrl });
    if (navigation.errorText) throw new Error(navigation.errorText);
    let pageReady = false;
    for (let i = 0; i < 150; i++) {
      if (await evaluateInPage(`window.__radarReady === true`)) { pageReady = true; break; }
      await sleep(100);
    }
    if (!pageReady) throw new Error('Page not ready: ' + name);
    if (setupScript) await evaluateInPage(setupScript);
    await evaluateInPage(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    await sleep(300);
    const { data: shotData } = await sendCommand('Page.captureScreenshot', { format: 'jpeg', quality, fromSurface: true, captureBeyondViewport: false });
    const imageBuffer = Buffer.from(shotData, 'base64');
    await writeFile(join(repoRoot, 'screenshots', name), imageBuffer);
    const dimensions = jpegDimensions(imageBuffer);
    const visibleRows = await evaluateInPage(`document.querySelectorAll('#rows tr').length`);
    console.log(JSON.stringify({ name, bytes: imageBuffer.length, ...dimensions, rows: visibleRows, consoleErrors: pageErrors.length, errors: pageErrors.slice(0, 2) }));
    if (imageBuffer.length > 524288) throw new Error(`Screenshot over 512 KiB: ${name} (${imageBuffer.length})`);
    if (dimensions.width !== 1440 || dimensions.height !== 900) throw new Error(`Wrong dimensions: ${name}`);
    if (pageErrors.length) throw new Error(`Console errors on ${name}: ${JSON.stringify(pageErrors).slice(0, 500)}`);
    return imageBuffer.length;
  }

  // Three captures cover the board, one open detail dialog, and the watchlist filter.
  await mkdir(join(repoRoot, 'screenshots'), { recursive: true });
  // 1. Board view (default render, sorted by implied value).
  await captureShot('1-board.jpg');
  // 2. Detail view: open the top-ranked protocol's dialog.
  await captureShot('2-detail.jpg', `document.querySelector('#rows tr[data-slug]').click(); document.querySelector('#detail').open`);
  // 3. Filtered view: watchlist-only filter applied.
  await captureShot('3-filtered.jpg', `document.querySelector('#watch').checked = true; document.querySelector('#watch').dispatchEvent(new Event('change', {bubbles:true})); document.querySelector('#result-count').textContent`);
  console.log('SHOTS OK quality=' + quality);
} finally {
  devtoolsSocket?.close();
  await stopBrowser(browserProcess);
  server.close();
}
