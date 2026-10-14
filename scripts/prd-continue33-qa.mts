#!/usr/bin/env npx tsx
import {mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue33-qa';
mkdirSync(outDir, {recursive: true});

const accept = spawnSync('node', [join(root, 'qa/prd-continue33-acceptance.mjs')], {
  cwd: root, encoding: 'utf8', env: {...process.env, QA_OUT: outDir},
});
process.stdout.write(accept.stdout || '');
process.stderr.write(accept.stderr || '');
if (accept.status !== 0) process.exit(accept.status || 1);

const unit = spawnSync('npx', ['tsx', '--test', 'studio/core/interface-locale.test.ts', 'studio/core/studio-review-tasks.test.ts'], {
  cwd: root, encoding: 'utf8',
});
process.stdout.write(unit.stdout || '');
process.stderr.write(unit.stderr || '');
if (unit.status !== 0) process.exit(unit.status || 1);

writeFileSync(join(outDir, 'craft-note.txt'),
  'continue33: Studio refreshReviewTasks referenceStatus/resultSummary → t(reviewTask.ref*|result*|disposition*|coverage*); fixture resumes resumePracticeForTyping. No video capsule. Cards glass peer deferred (real ZH shipped).\n');
console.log('continue33 QA in', outDir);
