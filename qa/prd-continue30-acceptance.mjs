#!/usr/bin/env node
/** PRD continue30 — HUD micro craft: typing-follow-toggle, pace-chip residual, kids chrome residual; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue30-qa';
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
check('CSS continue30 marker', /continue30 — typing-follow-toggle \/ pace-chip residual/.test(css));
check('CSS typing-follow-toggle glass', /\.typing-follow-toggle\.hud-glyph,[\s\S]*backdrop-filter:blur\(12px\)/.test(css));
check('CSS follow toggle 1.5 stroke', /\.typing-follow-toggle\.hud-glyph svg[\s\S]*stroke-width:1\.5/.test(css));
check('no new Follow logic invent', studio.includes('typing-follow-toggle') && studio.includes('startFollow') && !/fakeFollowAdaptive|inventFollow/.test(studio + css));
check('CSS pace-chip denser tabular', /pace-chip residual after continue22/.test(css) && /\.typing-pace-chip\{[\s\S]*font-variant-numeric:tabular-nums/.test(css));
check('CSS pace adaptive tint', /\[data-pace-mode=adaptive\] \.typing-pace-chip\{[\s\S]*#7ad7ff88/.test(css));
check('no new pace modes', !/paceMode:'turbo'|inventPace/.test(studio + css));
check('CSS kids chrome residual', /kids-edition chrome residual — orb\/float peer polish only/.test(css));
check('kids amplitude translate kept', /translate3d\(18px,-26px,0\)/.test(css));
check('kids breathScale 1.48 kept', /breathScale:1\.48/.test(kids));
check('prior continue29 keyboard-toggle kept', /continue29 — keyboard-toggle \/ input-settings-toggle/.test(css));
check('prior continue28 mute kept', /continue28 — mute-hit residual/.test(transparent));
check('prior continue22 input-card kept', /continue22 — input-card plate/.test(inputCard));
check('prior continue21 camera size locked', /size locked/.test(transparent));
check('prior continue18 passive keyboard kept', /continue18 — passive keyboard glass weight/.test(inputCard));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE'))
  && studio.includes('toggleKeyboard'));
check('kids continue17 marker kept', /continue17 — same contrast tokens; breathScale up/.test(kids));
check('camera 20px peer lock CSS kept', /max-width:20px;max-height:20px/.test(css) || /reinforce camera glyph peer size lock/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue30-hud-follow-pace-kids',
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
writeFileSync(join(outDir, 'prd-continue30-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
