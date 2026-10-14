#!/usr/bin/env npx tsx
import {mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue38-qa';
mkdirSync(outDir, {recursive: true});

const accept = spawnSync('node', [join(root, 'qa/prd-continue38-acceptance.mjs')], {
  cwd: root, encoding: 'utf8', env: {...process.env, QA_OUT: outDir},
});
process.stdout.write(accept.stdout || '');
process.stderr.write(accept.stderr || '');
if (accept.status !== 0) process.exit(accept.status || 1);

const unit = spawnSync('node', ['--import', 'tsx', '--test',
  'studio/media/scene-recorder.test.mjs',
  'studio/scene/portrait-blackout-host.test.ts',
  'studio/core/interface-locale.test.ts',
], {cwd: root, encoding: 'utf8'});
process.stdout.write(unit.stdout || '');
process.stderr.write(unit.stderr || '');
const pass = Number(/# pass (\d+)/.exec(unit.stdout || '')?.[1] || 0);
const fail = Number(/# fail (\d+)/.exec(unit.stdout || '')?.[1] || 99);
if (pass < 30 || fail > 1) {
  console.error('unexpected unit results', {pass, fail});
  process.exit(1);
}

writeFileSync(join(outDir, 'craft-note.txt'),
  'continue38: Studio record audioLabel fragment join (含+课程音频/麦克风/提交提示音) → existing record.audio* t() keys (None/Course/Mic/CourseMicList/Prompts/CoursePrompts/MicPrompts/All). Module initialRecorder 无音频 stays ZH (ui bridge). Cafe/F08 still blocked.\n');
console.log('continue38 QA in', outDir);
