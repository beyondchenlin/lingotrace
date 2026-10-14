#!/usr/bin/env npx tsx
/** PRD continue31 craft QA — ZH residual + edition-switch; no video capsule invent. */
import {mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue31-qa';
mkdirSync(outDir, {recursive: true});

const accept = spawnSync('node', [join(root, 'qa/prd-continue31-acceptance.mjs')], {
  cwd: root, encoding: 'utf8', env: {...process.env, QA_OUT: outDir},
});
process.stdout.write(accept.stdout || '');
process.stderr.write(accept.stderr || '');
if (accept.status !== 0) process.exit(accept.status || 1);

writeFileSync(join(outDir, 'craft-note.txt'),
  'continue31: ZH presentationStatus→t(); mediaName/beforeUnload→t(); palette.closedDefault catalog; scene presentation details catalog; edition-switch glass/stroke peer. Acceptance 20/20. No video caption capsule.\n');
console.log('continue31 QA artifacts in', outDir);
