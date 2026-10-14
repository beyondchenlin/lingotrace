#!/usr/bin/env node
/** PRD continue28 — HUD micro craft: mute-hit residual, submit-hit residual, hud-popover chrome; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue28-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const hud = readFileSync(join(root, 'studio/components/HudControls.tsx'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('no video caption capsule comment path', /No video-overlay caption capsule/.test(transparent));
check('no capsule markers', !/video-caption-capsule|glass-caption-capsule/.test(transparent + studio));
check('CSS continue28 marker', /continue28 — mute-hit residual \/ submit-hit residual/.test(css));
check('canvas mute-hit residual', /continue28 — mute-hit residual glass peer/.test(transparent));
check('mute stroke stays 1.5', /continue28 — mute-hit residual[\s\S]*lineWidth=1\.5/.test(transparent));
check('canvas submit-hit residual', /continue28 — submit-hit residual specular/.test(transparent));
check('Enter glyph Check kept', /Bare line-art Enter\/Return/.test(transparent) && /sw=1\.5\*icon\/20/.test(transparent));
check('submit floor hairline', /continue28 — submit-hit residual[\s\S]*button\.y\+button\.h-2\.1/.test(transparent));
check('CSS mute-hit glass', /\.mute-hit\{[\s\S]*inset 0 0 0 1px #c9e2d828/.test(css));
check('CSS submit-hit press', /\.submit-hit:active\{[\s\S]*scale\(\.985\)/.test(css));
check('CSS hud-popover denser glass', /hud-popover chrome — denser glass plate/.test(css) && /\.hud-popover\{[\s\S]*blur\(24px\)/.test(css));
check('CSS hud-popover section hierarchy', /\.hud-popover \.hud-section-label\{[\s\S]*border-bottom:1px solid #c9e2d820/.test(css));
check('HudPopover component kept no IA invent', hud.includes('hud-popover') && !/inventedMenu/.test(hud));
check('prior continue27 play-hit kept', /continue27 — play-hit glass well peer/.test(transparent));
check('prior continue26 fullscreen kept', /continue26 — fullscreen-hit/.test(css) || /continue26 — fullscreen-hit glass well/.test(readFileSync(join(root, 'studio/scene/renderer.ts'), 'utf8')));
check('prior continue22 input-card kept', /continue22 — input-card plate/.test(inputCard));
check('prior continue21 camera size locked', /size locked/.test(transparent));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('kids breathScale continue17 kept', /breathScale:1\.48/.test(kids));
check('kids CSS amplitude continue17 kept', /translate3d\(18px,-26px,0\)/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue28-hud-mute-submit-popover',
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
writeFileSync(join(outDir, 'prd-continue28-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
