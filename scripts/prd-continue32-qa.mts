#!/usr/bin/env npx tsx
/** PRD continue32 craft QA — LayoutEditor ZH residuals; no video capsule. */
import {mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue32-qa';
mkdirSync(outDir, {recursive: true});

const accept = spawnSync('node', [join(root, 'qa/prd-continue32-acceptance.mjs')], {
  cwd: root, encoding: 'utf8', env: {...process.env, QA_OUT: outDir},
});
process.stdout.write(accept.stdout || '');
process.stderr.write(accept.stderr || '');
if (accept.status !== 0) process.exit(accept.status || 1);

const unit = spawnSync('npx', ['tsx', '--test', 'studio/core/studio-layout-transactions.test.ts'], {
  cwd: root, encoding: 'utf8',
});
process.stdout.write(unit.stdout || '');
process.stderr.write(unit.stderr || '');
if (unit.status !== 0) process.exit(unit.status || 1);

writeFileSync(join(outDir, 'craft-note.txt'),
  'continue32: LayoutEditor chrome → t(layoutEditor.*)+layout.cancel/apply; history/bookmark/layoutPlan panels already t()/ui(); layout-plan-file throws already catalog-matched. LAYOUT_NAMES stays ZH-canonical in transparent-layout. No video caption capsule.\n');
console.log('continue32 QA artifacts in', outDir);
