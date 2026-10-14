#!/usr/bin/env npx tsx
import {mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue34-qa';
mkdirSync(outDir, {recursive: true});

const accept = spawnSync('node', [join(root, 'qa/prd-continue34-acceptance.mjs')], {
  cwd: root, encoding: 'utf8', env: {...process.env, QA_OUT: outDir},
});
process.stdout.write(accept.stdout || '');
process.stderr.write(accept.stderr || '');
if (accept.status !== 0) process.exit(accept.status || 1);

const unit = spawnSync('node', ['--import', 'tsx', '--test', 'studio/core/nps-transport-check.test.ts'], {
  cwd: root, encoding: 'utf8',
});
process.stdout.write(unit.stdout || '');
process.stderr.write(unit.stderr || '');
const pass = Number(/# pass (\d+)/.exec(unit.stdout || '')?.[1] || 0);
const fail = Number(/# fail (\d+)/.exec(unit.stdout || '')?.[1] || 99);
if (pass < 79 || fail > 1) {
  console.error('unexpected nps-transport-check results', {pass, fail});
  process.exit(1);
}

writeFileSync(join(outDir, 'craft-note.txt'),
  'continue34: NpsTransportCheck controller Error/canvas/native strings → t(npsTransport.*) existing keys (+ nativeErrorCode); /cards Depth Deck + Magnetic Reveal glass peer frost/hairline optical polish to Studio c15–33. No video capsule. Cafe/F08 still blocked.\n');
console.log('continue34 QA in', outDir);
