#!/usr/bin/env node
/** PRD continue18 — HUD micro craft: passive-keyboard glass, cue-counter optical, review-sheet chrome; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue18-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('no video caption capsule comment path', /No video-overlay caption capsule/.test(transparent));
check('no capsule markers', !/video-caption-capsule|glass-caption-capsule|rgba\(6,14,20/.test(transparent + studio));
check('continue18 passive keyboard glass', /continue18 — passive keyboard glass weight/.test(inputCard));
check('continue18 keyboard plate deeper frost', /rgba\(26,40,46,\.78\)/.test(inputCard));
check('continue18 keyboard side falloff', /Soft side falloff/.test(inputCard));
check('continue18 cue-counter optical', /continue18 — cue-counter numeral optical/.test(transparent));
check('continue18 cue CUE caption', /txt\(c,'CUE'/.test(transparent));
check('continue18 cue SEMIBOLD numeral', /cueLabel[\s\S]*STUDIO_SEMIBOLD/.test(transparent));
check('CSS continue18 marker', /continue18 — review-sheet chrome/.test(css));
check('CSS review-stats continue18', /\.studio-dialog \.review-stats\{[\s\S]*border-radius:20px/.test(css));
check('CSS dialog glass continue18', /\.studio-dialog\{[\s\S]*border-radius:24px/.test(css));
check('prior continue17 timeline head kept', /continue17 timeline head weight/.test(transparent));
check('prior continue17 title-band kept', /continue17 optical type/.test(transparent));
check('prior continue17 kids motion kept', /continue17 kids motion/.test(transparent));
check('prior continue16 instrument ring kept', /continue16 instrument ring/.test(transparent));
check('prior continue15 typing well kept', /continue15 — soft typing well/.test(inputCard));
check('prior continue15 word rails kept', /continue15 word\/letter rails/.test(inputCard));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('kids breathScale continue17 kept', /breathScale:1\.48/.test(kids));
check('kids CSS amplitude continue17 kept', /translate3d\(18px,-26px,0\)/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue18-hud-keyboard-cue-review',
  sha,
  phoneAudioVerified: false,
  videoCaptionCapsule: false,
  assistedReferenceInTypingOnly: true,
  storyCafeWired: false,
  checks,
  passed: failed.length === 0,
  failed: failed.map((c) => c.name),
  skipped: ['F08 practice-duration contract', '/story/cafe/ author assets', 'admin/onboarding IA', 'phone audio Follow', 'cafe adaptive Follow'],
  liveExpectation: 'lingotrace-delta via claim+assign_alias',
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue18-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
