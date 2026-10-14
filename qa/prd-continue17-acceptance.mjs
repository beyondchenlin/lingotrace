#!/usr/bin/env node
/** PRD continue17 — HUD micro craft: timeline head, title-band optical, kids motion; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue17-qa';
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
check('continue17 timeline head weight', /continue17 timeline head weight/.test(transparent));
check('continue17 timeline trough', /continue17 timeline — heavier progress head/.test(transparent));
check('continue17 title-band optical', /continue17 optical type/.test(transparent));
check('continue17 kids motion orbs', /continue17 kids motion/.test(transparent));
check('CSS continue17 marker', /continue17 — timeline head \/ title-band optical \/ kids motion/.test(css));
check('CSS kids-float amplitude continue17', /continue17 kids motion amplitude/.test(css) && /translate3d\(18px,-26px,0\)/.test(css));
check('kids breathScale continue17', /breathScale:1\.48/.test(kids));
check('kids tone continue16 kept', /tone:'#ff9e2e'/.test(kids));
check('kids traceTone continue16 kept', /traceTone:'#5ecfff'/.test(kids));
check('kids plateRadius 22 kept', /plateRadius:22/.test(kids));
check('pro plateAlpha 1.08 kept', /plateAlpha:1\.08/.test(kids));
check('prior continue16 instrument ring kept', /continue16 instrument ring/.test(transparent));
check('prior continue16 needle weight kept', /continue16 needle weight/.test(transparent));
check('prior continue15 typing well kept', /continue15 — soft typing well/.test(inputCard));
check('prior continue15 word rails kept', /continue15 word\/letter rails/.test(inputCard));
check('prior continue15 market glass kept', /continue15 market glass: deeper frost/.test(transparent));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('kids CSS contrast boost kept', css.includes('data-visual-edition=kids') && css.includes('#ff9e2ecc'));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue17-hud-timeline-titleband-kids',
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
writeFileSync(join(outDir, 'prd-continue17-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
