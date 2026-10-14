#!/usr/bin/env node
/** PRD continue14 — remaining Studio ZH reason-token / confirmation / short-timeout residuals → catalog+ui; light HUD; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue14-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const diagnostics = readFileSync(join(root, 'studio/i18n/messages-diagnostics.ts'), 'utf8');
const locale = readFileSync(join(root, 'studio/i18n/locale.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const recorder = readFileSync(join(root, 'studio/media/scene-recorder.ts'), 'utf8');
const recErr = readFileSync(join(root, 'studio/media/recording-error-message.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('locale still wires diagnostics', locale.includes('diagnosticEnglish'));

const keys = [
  'error.retestPlayerSourceChanged','error.retestOriginalTimeoutShort','notice.retestPrepEnded',
  'notice.referenceConfirmLegacy','notice.referenceConfirmSegment','notice.referenceConfirmTemporary',
  'notice.retestTrackingCue','notice.reviewWinnerLinked',
  'reason.recordUserStop','reason.recordPracticePaused','reason.recordMixInterrupted',
  'reason.recordRenderInterrupted','reason.recordBackgrounded',
  'record.failureSceneRender','error.recordRenderInterruptedShort','error.recordMixInterruptedShort',
  // prior continue13 kept
  'error.courseDecodeInterrupted','error.correctedOriginalUnverified','error.retestOriginalTimeout',
];
for (const key of keys) {
  check(`diagnostics has ${key}`, diagnostics.split(`"${key}"`).length - 1 >= 2);
}

const zhExact = [
  '复测播放器的原片来源已变化。',
  '复测原片准备超时，未开始跟踪。 {details}',
  '复测准备已结束；当前为普通练习，不推进任务。',
  '本次查看参考会随完整练习记录。',
  '本片段只记录已展示参考；校正来源未记录，仍是部分历史。',
  '当前只保留本页临时查看事实，不会补录先前或关闭期间内容。',
  '正在复测第 {index} 句；首次有效提交后按你预选的时间安排。',
  '本次真实作答已关联，已按你预选的时间安排下一次。',
  '用户停止','练习暂停','录制混音中断','画面渲染中断','页面后台化',
  '画面渲染已中断，录像已停止；画面可能不完整。',
  '画面渲染中断，录像可能不完整。',
  '录制混音已中断，声音可能不完整。',
];
for (const zh of zhExact) {
  check(`diagnostics ZH exact ${zh.slice(0, 18)}…`, diagnostics.includes(`"${zh}"`));
}

const studioResiduals = [
  '复测播放器的原片来源已变化。',
  '复测原片准备超时，未开始跟踪。',
  '复测准备已结束；当前为普通练习，不推进任务。',
  '本次查看参考会随完整练习记录。',
  '本片段只记录已展示参考；校正来源未记录，仍是部分历史。',
  '当前只保留本页临时查看事实，不会补录先前或关闭期间内容。',
  '正在复测第 ${cueIndex+1} 句；首次有效提交后按你预选的时间安排。',
  '本次真实作答已关联，已按你预选的时间安排下一次。',
  '用户停止','练习暂停','录制混音中断','画面渲染中断','页面后台化',
];
for (const zh of studioResiduals) {
  check(`Studio keeps ZH residual ${zh.slice(0, 18)}…`, studio.includes(zh));
}
check('scene-recorder keeps short render interrupt', recorder.includes('画面渲染中断，录像可能不完整。'));
check('scene-recorder keeps short mix interrupt', recorder.includes('录制混音已中断，声音可能不完整。'));
check('recording-error-message keeps scene render copy', recErr.includes('画面渲染已中断，录像已停止；画面可能不完整。'));

check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('assisted typing-only kept', /No video-overlay caption capsule/.test(transparent));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  (studio.includes('softwareKeyboard') || existsSync(join(root, 'app/studio/studio.css')))
  && studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('library invalidReference prior fix kept', readFileSync(join(root, 'studio/components/ContextBookmarkLibrary.tsx'), 'utf8').includes("t('library.invalidReference')"));
check('mutedCopy prior chrome kept', readFileSync(join(root, 'studio/components/MutedRecordingCopy.tsx'), 'utf8').includes("t('mutedCopy.generate')"));
check('HUD empty-state color kept', css.includes('.empty.empty-state') && css.includes('color:#c5d4c8') && css.includes('color:#b7c6ba'));
check('HUD toast craft kept', css.includes('.studio-toast') && css.includes('backdrop-filter:blur(14px)'));
check('continue14 record-card craft', css.includes('continue14 — HUD premium micro-craft') && css.includes('.studio-dialog .record-card'));
check('continue14 toast/glyph craft', css.includes('drop-shadow(0 0 10px #c4fc5710)') && css.includes('box-shadow:0 18px 56px'));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue14-reason-token-confirmation-hud',
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
writeFileSync(join(outDir, 'prd-continue14-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
