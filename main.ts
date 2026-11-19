import { cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
// Recorded refactor pass: identifiers clarified, behaviour unchanged.
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot, buildRadar, boardIssue, dataScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// Reads a --name value (or --name=value) from the command line, with a fallback.
function cliOption(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const flagName = `--${name}`;
  const equalsForm = argv.find((arg) => arg.startsWith(`${flagName}=`));
  if (equalsForm) return equalsForm.slice(flagName.length + 1);
  const flagIndex = argv.indexOf(flagName);
  if (flagIndex < 0) return fallback;
  const value = argv[flagIndex + 1];
  if (!value || value.startsWith('--')) throw Error(`${flagName} requires a path`);
  return value;
}

try {
  // Default input is the scorer's sealed mount (/input); --input overrides it for local runs.
  const inputPath = resolve(cliOption('input', '/input/snapshot.json'));
  const inputStat = statSync(inputPath);
  const snapshotFile = inputStat.isDirectory() ? join(inputPath, 'snapshot.json') : inputPath;
  const snapshotData = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
  const outputDir = resolve(cliOption('output', process.env.MAKEFUN_OUTPUT_DIR || '/output'));
  const repoRoot = fileURLToPath(new URL('.', import.meta.url));
  const { board, radar } = buildRadar(snapshotData);
  const boardProblem = boardIssue(board, snapshotData);
  if (boardProblem) throw Error(`Board gate refused: ${boardProblem}`);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(join(outputDir, 'data.js'), dataScript(radar));
  for (const name of ['dashboard', 'screenshots']) cpSync(join(repoRoot, name), join(outputDir, name), { recursive: true });
  // Dossier caps mirror the scorer's: 64 KiB of text, 3 screenshots, 400 dashboard files.
  const dossierBytes = buildDossier(outputDir, { text_max_bytes: 65536, screenshots: { max: 3, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
  if (dossierBytes.byteLength > 1572864) throw Error('dossier_matches: dossier exceeds 1.5 MiB');
  writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);
  console.log(`Signal Atlas: ${board.length} ranked; ${snapshotData.watchlist.length} watchlist; ${dossierBytes.byteLength} dossier bytes → ${outputDir}`);
} catch (failure) {
  console.error(`Signal Atlas build failed: ${failure instanceof Error ? failure.message : String(failure)}`);
  process.exitCode = 1;
}
