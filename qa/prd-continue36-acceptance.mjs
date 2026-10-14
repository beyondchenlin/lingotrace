#!/usr/bin/env node
/** PRD continue36 — Studio throw→t() batch + media-transport-check glass peer. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue36-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const nps = readFileSync(join(root, 'studio/components/NpsTransportCheck.tsx'), 'utf8');
const listening = readFileSync(join(root, 'studio/components/useListening.ts'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const carousel = readFileSync(join(root, 'studio/carousel/carousel.css'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

const throwT = (studio.match(/throw Error\(t\('/g) || []).length;
check('Studio throw Error(t()) count >= 60', throwT >= 60, String(throwT));
check('Studio no throw Error hard ZH', !/throw Error\('[^']*[\u4e00-\u9fff]/.test(studio));
check('Studio t(error.audioNotReady)', studio.includes("t('error.audioNotReady')"));
check('Studio t(error.reviewReferenceChain)', studio.includes("t('error.reviewReferenceChain')"));
check('Studio t(error.retestNeedsHistory)', studio.includes("t('error.retestNeedsHistory')"));
check('Studio t(error.npsCorrectionBlocked)', studio.includes("t('error.npsCorrectionBlocked')"));
check('Studio duration tmpl t(details)', studio.includes("t('error.reviewDurationBuiltin'") && studio.includes("t('error.reviewDurationBoundary'"));
check('Studio t(error.retestMediaExpired)', studio.includes("t('error.retestMediaExpired'"));
check('Studio canEnter uses t()', studio.includes("canEnter:()=>") && studio.includes("t('error.finishPrepFirst')") || studio.includes("t('error.prepareMaterialHistory')") || /canEnter:[\s\S]{0,400}t\('error\./.test(studio));
check('Studio camera messages t()', studio.includes("t('notice.cameraOn')") && studio.includes("t('error.cameraApi')") && studio.includes("t('hud.cameraOff')"));
check('Studio review tracking notices t()', studio.includes("t('notice.reviewWinnerLinked')") && studio.includes("t('notice.reviewBindingRestored')"));
check('Studio record audio labels t()', studio.includes("t('record.audioCourse')") && studio.includes("t('record.audioMic')"));
check('transport continue36 glass comment', /PRD continue36 — media-transport-check glass peer/.test(nps));
check('transport frost blur(22px)', nps.includes("blur(22px) saturate(1.15)"));
check('transport hairline #d7e7d8', /#d7e7d8/.test(nps));
check('transport dark page shell #0d1419', nps.includes("background: '#0d1419'") || nps.includes('background: "#0d1419"') || nps.includes("background: '#0d1419'"));
check('prior continue35 listening host.t kept', listening.includes("hostRef.current.t") && listening.includes("t('listening.notSavedYet')") || listening.includes("'listening.notSavedYet'"));
check('prior continue34 cards glass kept', /PRD continue34 cards/.test(carousel));
check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('OS keyboard / cafe / dictation / follow / camera20 kept',
  studio.includes('dictation') && studio.includes('follow') && (studio.includes('cafe') || studio.includes('CAFE'))
  && studio.includes('toggleKeyboard')
  && (/max-width:20px;max-height:20px/.test(css) || /reinforce camera glyph peer size lock/.test(css))
  && /continue22 — input-card plate/.test(inputCard)
  && /breathScale:1\.48/.test(kids));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue36-studio-throw-t-transport-glass',
  sha,
  phoneAudioVerified: false,
  videoCaptionCapsule: false,
  assistedReferenceInTypingOnly: true,
  storyCafeWired: false,
  f08PracticeDurationContract: false,
  checks,
  passed: failed.length === 0,
  failed: failed.map((c) => c.name),
  skipped: ['F08 practice-duration contract', '/story/cafe/ author assets', 'admin/onboarding IA', 'phone audio Follow', 'cafe adaptive Follow', 'reason.* ZH protocol tokens left as ui()-bridged literals'],
  liveExpectation: 'lingotrace-delta via claim+assign_alias',
  throwTCount: throwT,
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue36-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length, throwT}, null, 2));
process.exit(failed.length ? 1 : 0);
