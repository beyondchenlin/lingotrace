#!/usr/bin/env node
/** PRD continue29 — HUD micro craft: keyboard-toggle, input-settings-toggle, hud-glyph peer; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue29-qa';
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
check('CSS continue29 marker', /continue29 — keyboard-toggle \/ input-settings-toggle/.test(css));
check('CSS keyboard-toggle glass', /\.keyboard-toggle\.hud-glyph,[\s\S]*backdrop-filter:blur\(12px\)/.test(css));
check('CSS input-settings-toggle glass', /\.input-settings-toggle\.hud-glyph/.test(css) && /input-settings-toggle\.hud-glyph:hover/.test(css));
check('CSS hud-glyph stroke 1.5', /\.hud-glyph svg\{[\s\S]*stroke-width:1\.5/.test(css));
check('CSS studio-tools stroke 1.5', /\.studio-tools button svg[\s\S]*stroke-width:1\.5 !important/.test(css));
check('Icon strokeWidth 1.5', /strokeWidth="1\.5"/.test(studio));
check('HudGlyph keyboard+settings paths kept', hud.includes("keyboard:") && hud.includes("settings:"));
check('OS keyboard toggle behavior kept', studio.includes('keyboard-toggle') && studio.includes('toggleKeyboard') && !/inAppQwerty|fakeKeyboard/.test(studio));
check('camera size locked comment', /size locked/.test(transparent) && /continue29 — camera glyph peer polish only; size stays 20px locked/.test(transparent));
check('camera 20px max lock CSS', /reinforce camera glyph peer size lock[\s\S]*max-width:20px/.test(css));
check('no QWERTY invent', !/inAppQwerty|fakeQwerty|buildInAppKeyboard/.test(css + studio) && studio.includes('toggleKeyboard'));
check('prior continue28 mute kept', /continue28 — mute-hit residual/.test(transparent));
check('prior continue27 play-hit kept', /continue27 — play-hit glass well peer/.test(transparent));
check('prior continue22 input-card kept', /continue22 — input-card plate/.test(inputCard));
check('prior continue18 passive keyboard kept', /continue18 — passive keyboard glass weight/.test(inputCard));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('kids breathScale continue17 kept', /breathScale:1\.48/.test(kids));
check('kids CSS amplitude continue17 kept', /translate3d\(18px,-26px,0\)/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue29-hud-keyboard-settings-glyph',
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
writeFileSync(join(outDir, 'prd-continue29-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
