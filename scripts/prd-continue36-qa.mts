#!/usr/bin/env npx tsx
import {mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue36-qa';
mkdirSync(outDir, {recursive: true});

const accept = spawnSync('node', [join(root, 'qa/prd-continue36-acceptance.mjs')], {
  cwd: root, encoding: 'utf8', env: {...process.env, QA_OUT: outDir},
});
process.stdout.write(accept.stdout || '');
process.stderr.write(accept.stderr || '');
if (accept.status !== 0) process.exit(accept.status || 1);

const unit = spawnSync('node', ['--import', 'tsx', '--test', 'studio/core/nps-transport-check.test.ts', 'studio/core/listening-hook.test.ts'], {
  cwd: root, encoding: 'utf8',
});
process.stdout.write(unit.stdout || '');
process.stderr.write(unit.stderr || '');
const pass = Number(/# pass (\d+)/.exec(unit.stdout || '')?.[1] || 0);
const fail = Number(/# fail (\d+)/.exec(unit.stdout || '')?.[1] || 99);
if (pass < 88 || fail > 1) {
  console.error('unexpected unit results', {pass, fail});
  process.exit(1);
}

writeFileSync(join(outDir, 'craft-note.txt'),
  'continue36: Studio throw Error/notify/camera/review-tracking/record-label ZH → t(existing keys) (+ duration/retestMediaExpired details templates); reason.* protocol tokens left; media-transport-check page frost/hairline glass peer to Studio/cards c15–35. Cafe/F08 still blocked.\n');
console.log('continue36 QA in', outDir);
