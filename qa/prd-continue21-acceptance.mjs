#!/usr/bin/env node
/** PRD continue21 — HUD micro craft: transport-rail glyphs, mute-volume cluster, camera-inset frame; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue21-qa';
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
check('continue21 transport-rail glyphs', /continue21 — transport-rail glyphs/.test(transparent));
check('continue21 transport stroke peer 1.5', /sw=1\.5\*iconScale/.test(transparent));
check('continue21 mute-volume cluster', /continue21 — mute-volume cluster/.test(transparent));
check('continue21 volume ticks', /Volume level ticks/.test(transparent));
check('continue21 camera-inset frame', /continue21 — camera-inset frame/.test(transparent));
check('continue21 camera size locked peer', /size locked/.test(transparent) && /r\.w\/20/.test(transparent));
check('CSS continue21 marker', /continue21 — transport \/ mute-volume \/ camera/.test(css));
check('prior continue20 trend-panel kept', /continue20 — trend-panel glass plate/.test(transparent));
check('prior continue20 goal-dial kept', /continue20 — goal-dial specular/.test(transparent));
check('prior continue20 status-chip kept', /continue20 — title-band status-chip/.test(transparent));
check('prior continue19 flow-panel kept', /continue19 — flow-panel chrome/.test(transparent));
check('prior continue18 passive keyboard kept', /continue18 — passive keyboard glass weight/.test(inputCard));
check('prior continue17 timeline head kept', /continue17 timeline head weight/.test(transparent));
check('prior continue16 instrument ring kept', /continue16 instrument ring/.test(transparent));
check('prior continue15 typing well kept', /continue15 — soft typing well/.test(inputCard));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('kids breathScale continue17 kept', /breathScale:1\.48/.test(kids));
check('kids CSS amplitude continue17 kept', /translate3d\(18px,-26px,0\)/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue21-hud-transport-mute-camera',
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
writeFileSync(join(outDir, 'prd-continue21-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
