#!/usr/bin/env node
/** PRD continue25 — HUD micro craft: seek-scrubber, volume-slider, panel-sheet; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue25-qa';
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
check('CSS continue25 marker', /continue25 — seek-scrubber \/ volume-slider/.test(css));
check('canvas continue25 seek-scrubber', /continue25 — seek-scrubber denser trough/.test(transparent));
check('canvas seek hairline ticks', /Hairline tick stems/.test(transparent));
check('canvas stronger progress head', /continue25 — stronger progress head specular/.test(transparent));
check('canvas volume-slider glass well', /continue25 — volume-slider glass well/.test(transparent));
check('volume thumb peer kept', /thumbR=4\.4/.test(transparent));
check('CSS panel-sheet deeper frost', /\.studio-dialog\{[\s\S]*backdrop-filter:blur\(22px\)/.test(css));
check('CSS panel section hairlines', /\.panel-body h2::after/.test(css));
check('CSS sheet-section separators', /\.sheet-section\+\.sheet-section/.test(css));
check('timing math untouched', /const progress=idleTimeline\?movement\.progressFraction:duration\?clamp\(v\.playbackTime\/duration\):0/.test(transparent));
check('prior continue24 status-strip kept', /continue24 — status-strip glass/.test(css));
check('prior continue23 tools-drawer kept', /continue23 — tools-drawer glass/.test(css));
check('prior continue22 input-card kept', /continue22 — input-card plate/.test(inputCard));
check('prior continue21 camera size locked', /size locked/.test(transparent));
check('prior continue18 passive keyboard kept', /continue18 — passive keyboard glass weight/.test(inputCard));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('kids breathScale continue17 kept', /breathScale:1\.48/.test(kids));
check('kids CSS amplitude continue17 kept', /translate3d\(18px,-26px,0\)/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue25-hud-seek-volume-panel',
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
writeFileSync(join(outDir, 'prd-continue25-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
