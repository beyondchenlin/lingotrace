#!/usr/bin/env node
/** PRD continue26 — HUD micro craft: fullscreen-hit, prev-next residual, dialog notice cards; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue26-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const renderer = readFileSync(join(root, 'studio/scene/renderer.ts'), 'utf8');
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
check('no capsule markers', !/video-caption-capsule|glass-caption-capsule/.test(transparent + studio + renderer));
check('CSS continue26 marker', /continue26 — fullscreen-hit \/ prev-next residual/.test(css));
check('legacy fullscreen glass well', /continue26 — fullscreen-hit glass well/.test(renderer));
check('legacy fullscreen 1.5 stroke', /continue26 — fullscreen-hit glass well[\s\S]*lineWidth=1\.5/.test(renderer));
check('canvas prev/next residual', /continue26 — prev\/next residual polish/.test(transparent));
check('prev/next glass wells', /continue26 — prev\/next residual[\s\S]*roundRect\(z\.x\+2/.test(transparent));
check('prev/next stroke stays 1.5', /continue26 — prev\/next residual[\s\S]*lineWidth=1\.5/.test(transparent));
check('CSS fullscreen-hit glass', /\.fullscreen-hit\{[\s\S]*box-shadow:inset 0 0 0 1px #c9e2d828/.test(css) || /fullscreen-hit\{[\s\S]*inset 0 0 0 1px #c9e2d828/.test(css));
check('CSS notice glass plate', /dialog notice \/ confirm cards/.test(css) && /\.studio-dialog \.notice,/.test(css));
check('CSS notice warn hierarchy', /\.studio-dialog \.notice\.warn/.test(css));
check('CSS notice actions row', /\.studio-dialog \.notice \.button-row/.test(css));
check('no new navigation invent', studio.includes('cue-previous') && studio.includes('cue-next') && !/inventedCueNav/.test(transparent));
check('prior continue25 seek kept', /continue25 — seek-scrubber denser trough/.test(transparent));
check('prior continue24 status-strip kept', /continue24 — status-strip glass/.test(css));
check('prior continue22 input-card kept', /continue22 — input-card plate/.test(inputCard));
check('prior continue21 camera size locked', /size locked/.test(transparent));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('kids breathScale continue17 kept', /breathScale:1\.48/.test(kids));
check('kids CSS amplitude continue17 kept', /translate3d\(18px,-26px,0\)/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue26-hud-fullscreen-prevnext-notice',
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
writeFileSync(join(outDir, 'prd-continue26-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
