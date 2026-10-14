#!/usr/bin/env node
/** PRD continue24 — HUD micro craft: status-strip glass, follow-banner peer, record-banner optical; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue24-qa';
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
check('CSS continue24 marker', /continue24 — status-strip glass \/ follow-banner peer \/ record-banner optical/.test(css));
check('CSS status-strip glass', /\.status-strip\{[\s\S]*backdrop-filter:blur\(14px\)/.test(css));
check('CSS status-strip hairline', /\.status-strip::after/.test(css));
check('CSS follow-banner peer', /\.follow-intent-banner\{[\s\S]*backdrop-filter:blur\(20px\)/.test(css));
check('CSS follow-banner hairline', /\.follow-intent-banner::after/.test(css));
check('no invented beta content inject', !/content:"β/.test(css));
check('CSS record-banner optical', /\.record-banner\{[\s\S]*#6e3228f2/.test(css));
check('CSS record-banner hairline', /\.record-banner::after/.test(css));
check('follow/record banner classes kept', studio.includes('follow-intent-banner') && studio.includes('record-banner') && studio.includes('status-strip'));
check('prior continue23 tools-drawer kept', /continue23 — tools-drawer glass/.test(css));
check('prior continue23 toast kept', /continue23 — toast optical/.test(css) || /continue23 — toast optical enter/.test(studio));
check('prior continue23 course-banner kept', /continue23 — tools-drawer glass \/ toast optical \/ course-banner chrome/.test(css));
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
  feature: 'prd-continue24-hud-status-follow-record-banners',
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
writeFileSync(join(outDir, 'prd-continue24-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
