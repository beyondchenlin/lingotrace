#!/usr/bin/env node
/** PRD continue23 — HUD micro craft: tools-drawer glass, toast optical, course-banner chrome; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue23-qa';
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
check('no capsule markers', !/video-caption-capsule|glass-caption-capsule/.test(transparent + studio));
check('CSS continue23 marker', /continue23 — tools-drawer glass \/ toast optical \/ course-banner chrome/.test(css));
check('CSS tools-drawer deeper frost', /\.studio-tools-sheet,\.tools-drawer-grid\{[\s\S]*backdrop-filter:blur\(26px\)/.test(css));
check('CSS portrait drawer sheet glass', /\.portrait-layout \.studio-drawer\[data-drawer=sheet\]\{[\s\S]*blur\(26px\)/.test(css));
check('CSS toast optical', /\.studio-toast\{[\s\S]*backdrop-filter:blur\(16px\)/.test(css));
check('CSS toast hairline ::before', /\.studio-toast::before/.test(css));
check('CSS course-banner chrome', /\.course-intent-banner\{[\s\S]*backdrop-filter:blur\(20px\)/.test(css));
check('CSS course-banner hairline floor', /\.course-intent-banner::after/.test(css));
check('Studio toast soft motion keep types', /continue23 — toast optical enter\/exit soft/.test(studio) && studio.includes('studio-toast'));
check('course-intent-banner kept', studio.includes('course-intent-banner') && (studio.includes('cafe') || studio.includes('CAFE')));
check('prior continue22 input-card kept', /continue22 — input-card plate/.test(inputCard));
check('prior continue22 Check-hit kept', /continue22 — Check-hit glass well/.test(transparent));
check('prior continue21 camera size locked', /size locked/.test(transparent));
check('prior continue21 transport kept', /continue21 — transport-rail glyphs/.test(transparent));
check('prior continue20 trend-panel kept', /continue20 — trend-panel glass plate/.test(transparent));
check('prior continue18 passive keyboard kept', /continue18 — passive keyboard glass weight/.test(inputCard));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('kids breathScale continue17 kept', /breathScale:1\.48/.test(kids));
check('kids CSS amplitude continue17 kept', /translate3d\(18px,-26px,0\)/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue23-hud-drawer-toast-coursebanner',
  sha,
  phoneAudioVerified: false,
  videoCaptionCapsule: false,
  assistedReferenceInTypingOnly: true,
  storyCafeWired: false,
  f08PracticeDurationContract: false,
  checks,
  passed: failed.length === 0,
  failed: failed.map((c) => c.name),
  skipped: ['F08 practice-duration contract', '/story/cafe/ author assets', 'admin/onboarding IA', 'phone audio Follow', 'cafe adaptive Follow'],
  liveExpectation: 'lingotrace-delta via claim+assign_alias',
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue23-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
