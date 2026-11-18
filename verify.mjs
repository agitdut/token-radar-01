// Dev-only local gate check for token-radar-01 (not part of the graded entry).
// Usage: node main.ts --input input/snapshot.json --output /tmp/radar-out1
//        node verify.mjs /tmp/radar-out1 [snapshot.json]
// Re-checks every scorer gate row locally. Exit 1 on any FAIL.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const out = process.argv[2] || '/tmp/radar-out1';
const snapshotPath = process.argv[3] || '/home/hatch/workspace/makefun/agent-key/token-radar-01-kit-v20/input/snapshot.json';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const snap = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const known = new Set(snap.protocols.map((p) => p.slug));

// dashboard_files
try {
  const files = readdirSync(join(out, 'dashboard'));
  const hasHtml = files.includes('index.html');
  const hasCss = files.some((f) => f.endsWith('.css'));
  const hasJs = files.some((f) => f.endsWith('.js'));
  let total = 0, badName = null, netRef = null;
  for (const f of files) {
    const st = statSync(join(out, 'dashboard', f));
    if (!st.isFile()) { badName = f + ' (not a file)'; break; }
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(f) || f.startsWith('.') || f.startsWith('-')) { badName = f; break; }
    total += st.size;
    const text = readFileSync(join(out, 'dashboard', f), 'utf8');
    if (f.endsWith('.html') && /<(?:a|link|script|img|iframe)[^>]*(?:href|src)\s*=\s*["']https?:\/\//i.test(text)) netRef = f + ' (html attr)';
    if (f.endsWith('.css') && /https?:\/\//.test(text)) netRef = f + ' (css)';
    if (f.endsWith('.js') && /(?:from\s+["']|import\s*\(\s*["']|require\s*\(\s*["'])https?:\/\//.test(text)) netRef = f + ' (js import)';
    if (f.endsWith('.html') && /<style[^>]*>[^<]*https?:\/\//i.test(text)) netRef = f + ' (style body)';
  }
  const srcTotal = files.reduce((a, f) => a + statSync(join(out, 'dashboard', f)).size, 0);
  check('dashboard_files', hasHtml && hasCss && hasJs && !badName && !netRef && files.length <= 400 && total <= 4 * 1024 * 1024,
    `${files.length} files, ${total} bytes, source ${srcTotal} bytes${badName ? ', bad: ' + badName : ''}${netRef ? ', net: ' + netRef : ''}`);
} catch (e) { check('dashboard_files', false, String(e)); }

// board_file + sorted_by_value + coverage + farm_steps
try {
  const board = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
  const rows = board.rows;
  let issue = null;
  if (!Array.isArray(rows) || rows.length < 100 || rows.length > 4000) issue = `rows=${rows?.length}`;
  const seen = new Set();
  const ranked = [...rows].sort((a, b) => a.rank - b.rank);
  if (!issue) for (const [i, r] of ranked.entries()) {
    if (!known.has(r.slug) || seen.has(r.slug) || !r.name?.trim()) { issue = `identity ${r.slug}`; break; }
    seen.add(r.slug);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) { issue = `value ${r.slug}`; break; }
    if (r.rank !== i + 1 || (i && ranked[i - 1].implied_value_usd < r.implied_value_usd)) { issue = `rank/order at ${r.slug}`; break; }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12 ||
      r.farm_steps.some((t) => typeof t !== 'string' || t.trim().length < 20 || t.trim().length > 600)) { issue = `farm_steps ${r.slug}`; break; }
  }
  if (!issue && new Set(rows.map((r) => r.implied_value_usd)).size < 2) issue = 'all values equal';
  check('board_file', !issue, `${rows.length} rows${issue ? ', ' + issue : ''}`);
  check('sorted_by_value', !issue, issue || `ranks 1..${rows.length}, non-increasing values`);
  const missing = snap.watchlist.filter((s) => !seen.has(s));
  check('coverage', missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : `all ${snap.watchlist.length} watchlist slugs present`);
  const badSteps = rows.filter((r) => !Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12 ||
    r.farm_steps.some((t) => typeof t !== 'string' || t.trim().length < 20 || t.trim().length > 600));
  check('farm_steps', badSteps.length === 0, badSteps.length ? `${badSteps.length} bad rows` : `${rows.length} rows × ${rows[0].farm_steps.length} steps`);
  const top5 = ranked.slice(0, 5).map((r) => `${r.slug}=$${r.implied_value_usd.toLocaleString('en-US')}`).join(', ');
  console.log(`INFO top5: ${top5}`);
  console.log(`INFO board bytes: ${statSync(join(out, 'board.json')).size}`);
} catch (e) { check('board_file', false, String(e)); check('sorted_by_value', false, 'no board'); check('coverage', false, 'no board'); check('farm_steps', false, 'no board'); }

// screenshots
try {
  const shots = readdirSync(join(out, 'screenshots')).filter((f) => !f.startsWith('.'));
  let ok = shots.length >= 3 && shots.length <= 4, detail = `${shots.length} images`;
  for (const f of shots) {
    const b = readFileSync(join(out, 'screenshots', f));
    const isPng = b.readUInt32BE(0) === 0x89504e47;
    const isJpg = b.readUInt16BE(0) === 0xffd8;
    let w = 0, h = 0;
    if (isJpg) { for (let p = 2; p < b.length;) { if (b[p++] !== 0xff) break; while (b[p] === 0xff) p++; const m = b[p++], len = b.readUInt16BE(p); if ([0xc0, 0xc1, 0xc2].includes(m)) { w = b.readUInt16BE(p + 5); h = b.readUInt16BE(p + 3); break; } p += len; } }
    if (isPng) { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
    detail += ` | ${f} ${b.length}B ${w}x${h}`;
    if ((!isPng && !isJpg) || b.length > 524288 || Math.max(w, h) > 1440 || Math.min(w, h) < 800) ok = false;
  }
  check('screenshots', ok, detail);
} catch (e) { check('screenshots', false, String(e)); }

// dossier_matches
try {
  const stored = readFileSync(join(out, 'dossier.json'));
  const rebuilt = buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 3, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
  check('dossier_matches', Buffer.compare(stored, rebuilt) === 0 && stored.length <= 1572864, `${stored.length} bytes, rebuild ${rebuilt.length} bytes, identical=${Buffer.compare(stored, rebuilt) === 0}`);
} catch (e) { check('dossier_matches', false, String(e)); }

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `VERIFY: ${failed} FAILED` : 'VERIFY: ALL PASS');
process.exit(failed ? 1 : 0);
