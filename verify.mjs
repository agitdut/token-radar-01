// Dev-only local gate check for token-radar-01 (not part of the graded entry).
// Recorded refactor pass: identifiers clarified, behaviour unchanged.
// Usage: node main.ts --input input/snapshot.json --output /tmp/radar-out1
//        node verify.mjs /tmp/radar-out1 [snapshot.json]
// Re-checks every scorer gate row locally. Exit 1 on any FAIL.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const outputDir = process.argv[2] || '/tmp/radar-out1';
const snapshotFile = process.argv[3] || '/home/hatch/workspace/makefun/agent-key/token-radar-01-kit-v20/input/snapshot.json';
const checkResults = [];
function check(name, ok, detail = '') {
  checkResults.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const snapshotData = JSON.parse(readFileSync(snapshotFile, 'utf8'));
const knownSlugs = new Set(snapshotData.protocols.map((protocol) => protocol.slug));

// dashboard_files
try {
  const dashboardFiles = readdirSync(join(outputDir, 'dashboard'));
  const hasIndexHtml = dashboardFiles.includes('index.html');
  const hasStylesheet = dashboardFiles.some((fileName) => fileName.endsWith('.css'));
  const hasScript = dashboardFiles.some((fileName) => fileName.endsWith('.js'));
  let totalBytes = 0, invalidName = null, networkReference = null;
  for (const fileName of dashboardFiles) {
    const fileStats = statSync(join(outputDir, 'dashboard', fileName));
    if (!fileStats.isFile()) { invalidName = fileName + ' (not a file)'; break; }
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(fileName) || fileName.startsWith('.') || fileName.startsWith('-')) { invalidName = fileName; break; }
    totalBytes += fileStats.size;
    const fileText = readFileSync(join(outputDir, 'dashboard', fileName), 'utf8');
    if (fileName.endsWith('.html') && /<(?:a|link|script|img|iframe)[^>]*(?:href|src)\s*=\s*["']https?:\/\//i.test(fileText)) networkReference = fileName + ' (html attr)';
    if (fileName.endsWith('.css') && /https?:\/\//.test(fileText)) networkReference = fileName + ' (css)';
    if (fileName.endsWith('.js') && /(?:from\s+["']|import\s*\(\s*["']|require\s*\(\s*["'])https?:\/\//.test(fileText)) networkReference = fileName + ' (js import)';
    if (fileName.endsWith('.html') && /<style[^>]*>[^<]*https?:\/\//i.test(fileText)) networkReference = fileName + ' (style body)';
  }
  const sourceBytes = dashboardFiles.reduce((sum, fileName) => sum + statSync(join(outputDir, 'dashboard', fileName)).size, 0);
  check('dashboard_files', hasIndexHtml && hasStylesheet && hasScript && !invalidName && !networkReference && dashboardFiles.length <= 400 && totalBytes <= 4 * 1024 * 1024,
    `${dashboardFiles.length} files, ${totalBytes} bytes, source ${sourceBytes} bytes${invalidName ? ', bad: ' + invalidName : ''}${networkReference ? ', net: ' + networkReference : ''}`);
} catch (e) { check('dashboard_files', false, String(e)); }

// board_file + sorted_by_value + coverage + farm_steps
try {
  const boardData = JSON.parse(readFileSync(join(outputDir, 'board.json'), 'utf8'));
  const boardRows = boardData.rows;
  let boardProblem = null;
  if (!Array.isArray(boardRows) || boardRows.length < 100 || boardRows.length > 4000) boardProblem = `rows=${boardRows?.length}`;
  const seenSlugs = new Set();
  const rankedRows = [...boardRows].sort((first, second) => first.rank - second.rank);
  if (!boardProblem) for (const [index, row] of rankedRows.entries()) {
    if (!knownSlugs.has(row.slug) || seenSlugs.has(row.slug) || !row.name?.trim()) { boardProblem = `identity ${row.slug}`; break; }
    seenSlugs.add(row.slug);
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) { boardProblem = `value ${row.slug}`; break; }
    if (row.rank !== index + 1 || (index && rankedRows[index - 1].implied_value_usd < row.implied_value_usd)) { boardProblem = `rank/order at ${row.slug}`; break; }
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12 ||
      row.farm_steps.some((step) => typeof step !== 'string' || step.trim().length < 20 || step.trim().length > 600)) { boardProblem = `farm_steps ${row.slug}`; break; }
  }
  if (!boardProblem && new Set(boardRows.map((row) => row.implied_value_usd)).size < 2) boardProblem = 'all values equal';
  check('board_file', !boardProblem, `${boardRows.length} rows${boardProblem ? ', ' + boardProblem : ''}`);
  check('sorted_by_value', !boardProblem, boardProblem || `ranks 1..${boardRows.length}, non-increasing values`);
  const missingSlugs = snapshotData.watchlist.filter((slug) => !seenSlugs.has(slug));
  check('coverage', missingSlugs.length === 0, missingSlugs.length ? `missing: ${missingSlugs.join(',')}` : `all ${snapshotData.watchlist.length} watchlist slugs present`);
  const invalidStepRows = boardRows.filter((row) => !Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12 ||
    row.farm_steps.some((step) => typeof step !== 'string' || step.trim().length < 20 || step.trim().length > 600));
  check('farm_steps', invalidStepRows.length === 0, invalidStepRows.length ? `${invalidStepRows.length} bad rows` : `${boardRows.length} rows × ${boardRows[0].farm_steps.length} steps`);
  const topFive = rankedRows.slice(0, 5).map((row) => `${row.slug}=$${row.implied_value_usd.toLocaleString('en-US')}`).join(', ');
  console.log(`INFO top5: ${topFive}`);
  console.log(`INFO board bytes: ${statSync(join(outputDir, 'board.json')).size}`);
} catch (e) { check('board_file', false, String(e)); check('sorted_by_value', false, 'no board'); check('coverage', false, 'no board'); check('farm_steps', false, 'no board'); }

// screenshots: 3–4 JPEG/PNG images, each at most 512 KiB and at least 800px on the short side.
try {
  const shotFiles = readdirSync(join(outputDir, 'screenshots')).filter((fileName) => !fileName.startsWith('.'));
  let screenshotsOk = shotFiles.length >= 3 && shotFiles.length <= 4;
  let shotDetail = `${shotFiles.length} images`;
  for (const fileName of shotFiles) {
    const imageBytes = readFileSync(join(outputDir, 'screenshots', fileName));
    const isPngImage = imageBytes.readUInt32BE(0) === 0x89504e47;
    const isJpegImage = imageBytes.readUInt16BE(0) === 0xffd8;
    let width = 0, height = 0;
    if (isJpegImage) { for (let offset = 2; offset < imageBytes.length;) { if (imageBytes[offset++] !== 0xff) break; while (imageBytes[offset] === 0xff) offset++; const markerCode = imageBytes[offset++], segmentLength = imageBytes.readUInt16BE(offset); if ([0xc0, 0xc1, 0xc2].includes(markerCode)) { width = imageBytes.readUInt16BE(offset + 5); height = imageBytes.readUInt16BE(offset + 3); break; } offset += segmentLength; } }
    if (isPngImage) { width = imageBytes.readUInt32BE(16); height = imageBytes.readUInt32BE(20); }
    shotDetail += ` | ${fileName} ${imageBytes.length}B ${width}x${height}`;
    if ((!isPngImage && !isJpegImage) || imageBytes.length > 524288 || Math.max(width, height) > 1440 || Math.min(width, height) < 800) screenshotsOk = false;
  }
  check('screenshots', screenshotsOk, shotDetail);
} catch (e) { check('screenshots', false, String(e)); }

// dossier_matches
try {
  const storedDossier = readFileSync(join(outputDir, 'dossier.json'));
  const rebuiltDossier = buildDossier(outputDir, { text_max_bytes: 65536, screenshots: { max: 3, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
  check('dossier_matches', Buffer.compare(storedDossier, rebuiltDossier) === 0 && storedDossier.length <= 1572864, `${storedDossier.length} bytes, rebuild ${rebuiltDossier.length} bytes, identical=${Buffer.compare(storedDossier, rebuiltDossier) === 0}`);
} catch (e) { check('dossier_matches', false, String(e)); }

const failedCount = checkResults.filter((result) => !result.ok).length;
console.log(failedCount ? `VERIFY: ${failedCount} FAILED` : 'VERIFY: ALL PASS');
process.exit(failedCount ? 1 : 0);
