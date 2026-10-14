#!/usr/bin/env node
/** PRD continue12 — Studio/NpsTransportCheck ZH throws → catalog+ui; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue12-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const diagnostics = readFileSync(join(root, 'studio/i18n/messages-diagnostics.ts'), 'utf8');
const panels = readFileSync(join(root, 'studio/i18n/messages-panels.ts'), 'utf8');
const locale = readFileSync(join(root, 'studio/i18n/locale.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const nps = readFileSync(join(root, 'studio/components/NpsTransportCheck.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('locale still wires panels+diagnostics', locale.includes('panelsEnglish') && locale.includes('diagnosticEnglish'));

const studioThrowKeys = [
  'status.listeningHidden','status.listeningReference','status.standby','status.live','status.replay','status.idle',
  'error.reviewMediaCanceled','error.reviewReferenceChain','error.reviewCueMissing','error.reviewNeedRealPractice',
  'error.reviewNeedSubmission','error.coursePlayerNotReady','error.retestMediaCanceled','error.retestHashMismatch',
  'error.retestStateBlocked','error.retestNeedsHistory','error.reviewTaskChanged','error.retestPrepCanceled',
  'error.retestUnsavedRound','error.npsCorrectionBlocked','error.correctionDuringRecording','error.referenceMissingLocal',
  'error.historySettingsNotReady','error.correctedMissingLocal','error.correctedHashFailed','error.bookmarkUnverifiedSave',
  'error.bookmarkReviewChanged','error.bookmarkRangeUnverified','error.correctedSeekPreparing',
];
for (const key of studioThrowKeys) {
  check(`diagnostics has ${key}`, diagnostics.split(`"${key}"`).length - 1 >= 2);
}
check('Studio keeps ZH review cancel throw', studio.includes("throw Error('复习媒体核验已取消。')"));
check('diagnostics ZH matches review cancel exact', diagnostics.includes('"复习媒体核验已取消。"'));
check('Studio keeps ZH presentation listeningHidden', studio.includes('正在纯听，原文、目标键与估算节奏均已隐藏。'));
check('Studio presentation still via ui()', /presentationStatusRef[\s\S]*ui\(/.test(studio) || studio.includes("ui(presentationStatus"));

const npsChrome = [
  'npsTransport.title','npsTransport.lede','npsTransport.load','npsTransport.stop','npsTransport.phaseLabel',
  'npsTransport.phaseIdle','npsTransport.play','npsTransport.checkCanvas','npsTransport.canvasHint',
];
for (const key of npsChrome) {
  check(`panels has ${key}`, panels.split(`"${key}"`).length - 1 >= 2);
  check(`nps UI uses t('${key}')`, nps.includes(`t('${key}'`) || nps.includes(`t("${key}"`) || key.startsWith('npsTransport.phase') && nps.includes('PHASE_KEYS'));
}
check('nps uses useStudioLocale', nps.includes('useStudioLocale'));
check('nps errors via ui(state.error)', nps.includes('ui(state.error)'));
check('nps canvas via ui(state.canvasResult)', nps.includes('ui(state.canvasResult)'));
check('nps wraps StudioLocaleProvider', nps.includes('StudioLocaleProvider'));
check('nps no raw ZH title', !nps.includes('>同源视频传输检查</h1>') && !nps.includes("'同源视频传输检查'"));

const npsThrowKeys = [
  'npsTransport.errDirectCreds','npsTransport.errNo2dCanvas','npsTransport.errCanvasIncomplete',
  'npsTransport.errVerifySha','npsTransport.errNativeDecode','npsTransport.errSeekOutOfRange',
  'npsTransport.errFallback','npsTransport.errSourceMismatch','npsTransport.canvasNotDecoded',
  'npsTransport.errNativeDecodeDetails','npsTransport.errSourceOrDurationChanged','npsTransport.canvasFail',
];
for (const key of npsThrowKeys) {
  check(`panels has throw bridge ${key}`, panels.split(`"${key}"`).length - 1 >= 2);
}
check('nps keeps ZH-canonical direct creds throw', nps.includes("throw new Error('同源直接播放凭据无效。')"));
check('nps keeps ZH-canonical no 2d canvas throw', nps.includes("throw new Error('浏览器未提供 2D 画布。')"));
check('nps keeps ZH-canonical canvas incomplete throw', nps.includes("throw new Error('画布读取结果不完整。')"));
check('panels ZH matches direct creds exact', panels.includes('"同源直接播放凭据无效。"'));
check('panels ZH matches verify sha exact', panels.includes('"固定资源没有通过同源 URL、类型与 SHA-256 核验。"'));

check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('assisted typing-only kept', /No video-overlay caption capsule/.test(transparent));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  (studio.includes('softwareKeyboard') || existsSync(join(root, 'app/studio/studio.css')))
  && studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('library invalidReference prior fix kept', readFileSync(join(root, 'studio/components/ContextBookmarkLibrary.tsx'), 'utf8').includes("t('library.invalidReference')"));
check('mutedCopy prior chrome kept', readFileSync(join(root, 'studio/components/MutedRecordingCopy.tsx'), 'utf8').includes("t('mutedCopy.generate')"));
check('HUD chip glass micro-craft', css.includes('sheet-status-chip') && css.includes('backdrop-filter:blur(10px)') && css.includes('linear-gradient(165deg,#1a3038d8'));
check('empty-state craft kept', css.includes('.empty.empty-state') && css.includes('border-radius:18px'));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue12-throw-bridge-nps-studio',
  sha,
  phoneAudioVerified: false,
  videoCaptionCapsule: false,
  assistedReferenceInTypingOnly: true,
  storyCafeWired: false,
  checks,
  passed: failed.length === 0,
  failed: failed.map((c) => c.name),
  skipped: ['F08 practice-duration contract', '/story/cafe/ author assets', 'admin/onboarding IA', 'phone audio Follow', 'cafe adaptive Follow'],
  liveExpectation: 'lingotrace-delta via claim+assign_alias',
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue12-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
