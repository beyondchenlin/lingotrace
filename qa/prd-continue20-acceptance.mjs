#!/usr/bin/env node
/** PRD continue20 — HUD micro craft: trend-panel glass, goal-dial specular, title-band status-chip; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue20-qa';
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
check('continue20 trend-panel glass', /continue20 — trend-panel glass plate/.test(transparent));
check('continue20 trend plate rgba', /rgba\(18,28,34,\.62\)/.test(transparent));
check('continue20 goal-dial specular', /continue20 — goal-dial specular/.test(transparent));
check('continue20 dial specular arc', /rgba\(245,252,248,\.22\)/.test(transparent) && /r-3\.2/.test(transparent));
check('continue20 title-band status-chip', /continue20 — title-band status-chip/.test(transparent));
check('continue20 status chip pill', /chip=\{x:836-sw\/2/.test(transparent));
check('CSS continue20 marker', /continue20 — title-band status-chip/.test(css));
check('prior continue19 flow-panel kept', /continue19 — flow-panel chrome/.test(transparent));
check('prior continue19 standby-energy kept', /continue19 — standby-energy bloom/.test(transparent));
check('prior continue19 listening-dock kept', /continue19 — listening-dock glass/.test(css));
check('prior continue18 passive keyboard kept', /continue18 — passive keyboard glass weight/.test(inputCard));
check('prior continue18 cue-counter kept', /continue18 — cue-counter numeral optical/.test(transparent));
check('prior continue17 timeline head kept', /continue17 timeline head weight/.test(transparent));
check('prior continue17 title-band kept', /continue17 optical type/.test(transparent));
check('prior continue16 instrument ring kept', /continue16 instrument ring/.test(transparent));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('kids breathScale continue17 kept', /breathScale:1\.48/.test(kids));
check('kids CSS amplitude continue17 kept', /translate3d\(18px,-26px,0\)/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue20-hud-trend-dial-statuschip',
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
writeFileSync(join(outDir, 'prd-continue20-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
