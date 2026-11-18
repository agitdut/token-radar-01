import { cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot, buildRadar, boardIssue, dataScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

function option(name: string, fallback: string): string {
  const args = process.argv.slice(2), flag = `--${name}`;
  const equals = args.find(a => a.startsWith(`${flag}=`));
  if (equals) return equals.slice(flag.length + 1);
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`${flag} requires a path`);
  return args[i + 1];
}

try {
  // Default input is the scorer's sealed mount (/input); --input overrides it for local runs.
  const input = resolve(option('input', '/input/snapshot.json'));
  const snapshot = parseSnapshot(readFileSync(statSync(input).isDirectory() ? join(input, 'snapshot.json') : input, 'utf8'));
  const out = resolve(option('output', process.env.MAKEFUN_OUTPUT_DIR || '/output'));
  const root = fileURLToPath(new URL('.', import.meta.url));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue) throw Error(`Board gate refused: ${issue}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(join(out, 'data.js'), dataScript(radar));
  for (const name of ['dashboard', 'screenshots']) cpSync(join(root, name), join(out, name), { recursive: true });
  const dossier = buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 3, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
  if (dossier.byteLength > 1572864) throw Error('dossier_matches: dossier exceeds 1.5 MiB');
  writeFileSync(join(out, 'dossier.json'), dossier);
  console.log(`Signal Atlas: ${board.length} ranked; ${snapshot.watchlist.length} watchlist; ${dossier.byteLength} dossier bytes → ${out}`);
} catch (error) {
  console.error(`Signal Atlas build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
