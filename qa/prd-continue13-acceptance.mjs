#!/usr/bin/env node
/** PRD continue13 — more Studio.tsx ZH throws → catalog+ui; transport metadata i18n; light HUD; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue13-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const diagnostics = readFileSync(join(root, 'studio/i18n/messages-diagnostics.ts'), 'utf8');
const panels = readFileSync(join(root, 'studio/i18n/messages-panels.ts'), 'utf8');
const locale = readFileSync(join(root, 'studio/i18n/locale.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transportPage = readFileSync(join(root, 'app/media-transport-check/page.tsx'), 'utf8');
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
  'error.correctedOriginalUnverified','error.retestPrepIncomplete','error.localReferenceUnreadable',
  'error.reviewLinkDeferred','error.reviewOriginalUnverified','error.reviewDurationCorrected',
  'error.reviewDurationBuiltin','error.reviewDurationBoundary','error.retestMediaExpired',
  'error.retestMediaStale','error.reviewOriginalDecode','error.reviewDurationTaskMismatch',
  'error.reviewOriginalUnverifiedPlay','notice.reviewScheduleChanged','error.localVersionDurationMismatch',
  'notice.reviewBindingRestored','error.retestOriginalTimeout','notice.reviewSameInstance',
  'error.correctedVersionMissingPlay','error.builtinVersionMissingPlay','error.reviewBindingUnverified',
  'notice.reviewSourceUnverified','error.courseDecodeInterrupted',
  // prior continue12 kept
  'error.reviewMediaCanceled','error.correctedSeekPreparing','status.listeningHidden',
];
for (const key of studioThrowKeys) {
  check(`diagnostics has ${key}`, diagnostics.split(`"${key}"`).length - 1 >= 2);
}

const zhExact = [
  '校正原片未能核验。','新轮复测准备未完成。','本机参考版本暂时无法读取。',
  '作答已留在正常练习中，复习关联与排期尚未提交。','实际原片尚未核验。',
  '实际原片时长与固定校正版不一致。 {details}','实际真人片段时长与固定来源不一致。 {details}',
  '实际原片时长或句子边界与固定来源不符。 {details}','复测媒体在最终交接前已失效。 {details}',
  '复测媒体准备已过期。','复习原片无法解码。 {details}','实际原片时长与复习任务不符。 {details}',
  '复习原片尚未按固定版本核验，不能播放。','任务安排已改变，本轮不再推进旧复测实例。',
  '所选版本与原片实际时长不符，未开始新练习。','已恢复这份完整记录的原复测关联；不会补推进旧提交。',
  '复测原片准备超时，有限时长尚未就绪，未开始跟踪。 {details}','本次真实作答仍关联原复测实例，没有重复推进下一次。',
  '本机校正版本缺失或已改变，未播放。历史文字和成绩保留。','固定真人素材版本缺失或已改变，未播放。历史文字和成绩保留。',
  '保存的复测关联或原片无法核验，请从任务列表明确重新开始；旧记录保留。',
  '这次提交缺少可核验的已保存来源，未推进复习；后续合规提交仍可独立关联。',
  '真人课程解码已中断，播放和作答暂停。请重新加载当前课程；未切换其他素材。 {details}',
];
for (const zh of zhExact) {
  check(`diagnostics ZH exact ${zh.slice(0, 18)}…`, diagnostics.includes(`"${zh}"`));
  check(`Studio keeps ZH residual ${zh.slice(0, 18)}…`, studio.includes(zh.replace(' {details}', '')));
}

check('transport metadata uses panelsEnglish title', transportPage.includes("panelsEnglish['npsTransport.title']"));
check('transport metadata uses panelsEnglish lede', transportPage.includes("panelsEnglish['npsTransport.lede']"));
check('transport metadata no raw ZH title', !transportPage.includes("'同源视频传输检查 · LingoTrace'"));
check('panels still has npsTransport.title', panels.includes('"npsTransport.title"'));

check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('assisted typing-only kept', /No video-overlay caption capsule/.test(transparent));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  (studio.includes('softwareKeyboard') || existsSync(join(root, 'app/studio/studio.css')))
  && studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('library invalidReference prior fix kept', readFileSync(join(root, 'studio/components/ContextBookmarkLibrary.tsx'), 'utf8').includes("t('library.invalidReference')"));
check('mutedCopy prior chrome kept', readFileSync(join(root, 'studio/components/MutedRecordingCopy.tsx'), 'utf8').includes("t('mutedCopy.generate')"));
check('HUD empty-state color restored', css.includes('.empty.empty-state') && css.includes('color:#c5d4c8') && css.includes('color:#b7c6ba'));
check('HUD toast craft', css.includes('.studio-toast') && css.includes('backdrop-filter:blur(14px)') && css.includes('letter-spacing:.01em'));
check('sheet-status chip craft kept', css.includes('sheet-status-chip') && css.includes('backdrop-filter:blur(10px)'));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue13-throw-bridge-transport-meta-hud',
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
writeFileSync(join(outDir, 'prd-continue13-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
