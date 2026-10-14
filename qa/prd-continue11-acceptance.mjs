#!/usr/bin/env node
/** PRD continue11 — mutedCopy chrome + throw ZH→t()/ui() bridge; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue11-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const muted = readFileSync(join(root, 'studio/components/MutedRecordingCopy.tsx'), 'utf8');
const panels = readFileSync(join(root, 'studio/i18n/messages-panels.ts'), 'utf8');
const diagnostics = readFileSync(join(root, 'studio/i18n/messages-diagnostics.ts'), 'utf8');
const locale = readFileSync(join(root, 'studio/i18n/locale.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const mutedCtrl = readFileSync(join(root, 'studio/media/muted-copy-controller.ts'), 'utf8');
const bookmarkMedia = readFileSync(join(root, 'studio/media/context-bookmark-media.ts'), 'utf8');
const refTransition = readFileSync(join(root, 'studio/core/reference-transition.ts'), 'utf8');
const history = readFileSync(join(root, 'studio/core/training-history-recorder.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('locale still wires panels+diagnostics', locale.includes('panelsEnglish') && locale.includes('diagnosticEnglish'));

const mutedChrome = [
  'mutedCopy.aria','mutedCopy.title','mutedCopy.notice','mutedCopy.note','mutedCopy.consent',
  'mutedCopy.blocked','mutedCopy.generate','mutedCopy.generating','mutedCopy.cancel','mutedCopy.back',
  'mutedCopy.download','mutedCopy.previewNote',
];
for (const key of mutedChrome) {
  check(`panels has ${key} en+zh`, panels.split(`"${key}"`).length - 1 >= 2);
  check(`muted UI uses t('${key}')`, muted.includes(`t('${key}'`));
}
check('muted uses useStudioLocale', muted.includes('useStudioLocale'));
check('muted errors via ui(state.error)', muted.includes('ui(state.error)'));
check('muted no raw ZH title', !muted.includes('<h2>录像静音副本</h2>') && !muted.includes('aria-label="生成录像静音副本"'));
check('muted no raw generate ZH button', !muted.includes("'生成静音副本'") && !muted.includes('"生成静音副本"'));

const mutedThrowKeys = [
  'mutedCopy.errNoSourceData','mutedCopy.errTooLarge','mutedCopy.errWebmOnly','mutedCopy.errSourceDecode',
  'mutedCopy.errNoOutput','mutedCopy.errOutputVerify','mutedCopy.errFrameRange','mutedCopy.errContainerMismatch',
  'mutedCopy.errNoCanvas','mutedCopy.errDurationLimit','mutedCopy.errCanceled','mutedCopy.errUnverified',
];
for (const key of mutedThrowKeys) {
  check(`panels has throw bridge ${key}`, panels.split(`"${key}"`).length - 1 >= 2);
}
check('muted controller keeps ZH-canonical no-source throw', mutedCtrl.includes("throw new Error('原录像没有可读取的视频数据。')"));
check('panels ZH matches muted throw exact', panels.includes('"原录像没有可读取的视频数据。"'));

const bookmarkKeys = [
  'bookmarkMedia.errRequest','bookmarkMedia.errResourceIdentity','bookmarkMedia.errMime','bookmarkMedia.errEmptyBody',
  'bookmarkMedia.errLoadFailed','bookmarkMedia.errSourceMismatch','bookmarkMedia.errHashMismatch',
  'bookmarkMedia.errDigestUnavailable','bookmarkMedia.errDigestUnavailableTagged','bookmarkMedia.errGenericPlay',
];
for (const key of bookmarkKeys) {
  check(`panels has ${key}`, panels.split(`"${key}"`).length - 1 >= 2);
}
check('bookmark media keeps ZH request throw', bookmarkMedia.includes("throw new Error('原片请求失败。')"));
check('bookmark HASH_FAILURE ZH exact in panels', panels.includes('原片字节校验不匹配，不能播放当前片段。请重新加载原片后重试。 [hash; SHA256_MISMATCH]'));

const historyKeys = [
  'error.historyBoundaryMissing','error.historyBoundaryChanged','error.historyPermissionChanged',
  'error.historySavePending','error.referenceTransitionWait','error.referenceTransitionUnsaved',
  'error.referenceTransitionChanged',
];
for (const key of historyKeys) {
  check(`diagnostics has ${key}`, diagnostics.split(`"${key}"`).length - 1 >= 2);
}
check('history recorder keeps ZH boundary throw', history.includes("throw new Error('课程保存边界尚未建立。')"));
check('reference-transition keeps ZH wait throw', refTransition.includes("throw new Error('请先等待或重试当前允许内容的保存与历史设置，再切换素材版本。')"));

check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('assisted typing-only kept', /No video-overlay caption capsule/.test(transparent));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  (studio.includes('softwareKeyboard') || existsSync(join(root, 'app/studio/studio.css')))
  && studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('library invalidReference prior fix kept', readFileSync(join(root, 'studio/components/ContextBookmarkLibrary.tsx'), 'utf8').includes("t('library.invalidReference')"));
check('toast glass micro-craft', css.includes('studio-toast') && css.includes('backdrop-filter:blur(12px)'));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue11-throw-bridge-mutedcopy',
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
writeFileSync(join(outDir, 'prd-continue11-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
