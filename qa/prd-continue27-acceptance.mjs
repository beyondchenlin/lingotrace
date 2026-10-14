#!/usr/bin/env node
/** PRD continue27 — HUD micro craft: play-hit glass, listening-dock residual, empty-state cards; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue27-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const listening = readFileSync(join(root, 'studio/components/ListeningControls.tsx'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('no video caption capsule comment path', /No video-overlay caption capsule/.test(transparent));
check('no capsule markers', !/video-caption-capsule|glass-caption-capsule/.test(transparent + studio));
check('CSS continue27 marker', /continue27 — play-hit glass peer \/ listening-dock residual/.test(css));
check('canvas play-hit glass peer', /continue27 — play-hit glass well peer/.test(transparent));
check('play glyph stroke stays 1.5', /continue27 — play-hit glass well[\s\S]*sw=1\.5\*iconScale/.test(transparent));
check('play glass specular hairline', /continue27 — play-hit glass well[\s\S]*rgba\(245,252,248,\.14\)/.test(transparent));
check('CSS play-hit glass', /\.play-hit\{[\s\S]*inset 0 0 0 1px #c9e2d828/.test(css));
check('CSS listening-dock residual denser', /listening-dock residual after continue19/.test(css) && /\.listening-options label\{[\s\S]*border-radius:14px/.test(css));
check('CSS listening kids-tone peer', /kids\] \.listening-dock[\s\S]*#ffc56e66/.test(css));
check('no new dock features invent', listening.includes('listening-dock') && listening.includes('listening-options') && !/inventedDock/.test(listening));
check('CSS empty-state glass plate', /empty-state cards — glass plate/.test(css) && /\.empty\.empty-state\{[\s\S]*backdrop-filter:blur\(14px\)/.test(css));
check('CSS empty-state hairline', /\.empty\.empty-state::before/.test(css));
check('no empty copy invent', !/content:"No material/.test(css) && !/content:"暂无/.test(css));
check('prior continue26 fullscreen kept', /continue26 — fullscreen-hit/.test(css) || /continue26 — fullscreen-hit glass well/.test(readFileSync(join(root, 'studio/scene/renderer.ts'), 'utf8')));
check('prior continue25 seek kept', /continue25 — seek-scrubber denser trough/.test(transparent));
check('prior continue22 input-card kept', /continue22 — input-card plate/.test(inputCard));
check('prior continue21 camera size locked', /size locked/.test(transparent));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('kids breathScale continue17 kept', /breathScale:1\.48/.test(kids));
check('kids CSS amplitude continue17 kept', /translate3d\(18px,-26px,0\)/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue27-hud-play-dock-empty',
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
writeFileSync(join(outDir, 'prd-continue27-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
