#!/usr/bin/env node
/** PRD continue35 — listening/calendar/Studio ZH → t() existing keys; no capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue35-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const listening = readFileSync(join(root, 'studio/components/useListening.ts'), 'utf8');
const calendar = readFileSync(join(root, 'studio/components/RecordCalendarPanel.tsx'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const diag = readFileSync(join(root, 'studio/i18n/messages-diagnostics.ts'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const carousel = readFileSync(join(root, 'studio/carousel/carousel.css'), 'utf8');
const nps = readFileSync(join(root, 'studio/components/NpsTransportCheck.tsx'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('listening host optional t', listening.includes('t?:(key:MessageKey') || listening.includes('t?:(key: MessageKey'));
check('listening t(listening.notSavedYet)', listening.includes("t('listening.notSavedYet')") || listening.includes("'listening.notSavedYet'"));
check('listening t(listening.saving/saved)', listening.includes("t('listening.saving')") && listening.includes("t('listening.saved')"));
check('listening t(listening.temporary/checking)', listening.includes("t('listening.temporary')") && listening.includes("t('listening.checking')"));
check('listening t(listening.exportStale/historyReadFailed)', listening.includes("t('listening.exportStale')") && listening.includes("t('listening.historyReadFailed')"));
check('listening no hard ZH status lits', !/本次尚未自动保存|听力片段保存中|临时听力/.test(listening));
check('catalog listening.exportStale EN+ZH', (diag.match(/listening\.exportStale/g) || []).length >= 2);
check('catalog listening.historyReadFailed EN+ZH', (diag.match(/listening\.historyReadFailed/g) || []).length >= 2);
check('calendar t(listeningChanged/recordChanged)', calendar.includes("t('calendar.listeningChanged')") && calendar.includes("t('calendar.recordChanged')"));
check('calendar t(segmentChanged/invalidZone)', calendar.includes("t('calendar.segmentChanged')") && calendar.includes("t('calendar.invalidZone')"));
check('Studio guideInputOnly t()', studio.includes("t('studio.guideInputOnly')"));
check('Studio media.fixedTitle/localCorrectedTitle', studio.includes("t('media.fixedTitle'") && studio.includes("t('media.localCorrectedTitle'"));
check('Studio cameraFailure/cameraEnable t()', studio.includes("t('error.cameraFailure'") && studio.includes("t('error.cameraEnable')"));
check('Studio courseDecodeInterrupted t()', studio.includes("t('error.courseDecodeInterrupted'"));
check('Studio stopReviewTracking notice keys', studio.includes("t('notice.retestPrepEnded')") && studio.includes("t('notice.reviewScheduleChanged')") && studio.includes("t('notice.reviewTargetLeft')") && studio.includes("t('notice.mediaReviewStopped')") && studio.includes("t('notice.reviewBackground')"));
check('Studio passes t into useListening', studio.includes('useListening({t,'));
check('prior continue34 npsTransport t() kept', nps.includes("t('npsTransport.errFallback')") && nps.includes("options.t ?? defaultT"));
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
  feature: 'prd-continue35-listening-calendar-studio-zh-t',
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
writeFileSync(join(outDir, 'prd-continue35-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
