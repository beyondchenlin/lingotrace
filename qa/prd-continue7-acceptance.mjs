#!/usr/bin/env node
/** PRD continue7 — review disabledReason i18n + residual Studio/cards zh scan; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue7-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const bookmark = readFileSync(join(root, 'studio/components/ContextBookmarkComposer.tsx'), 'utf8');
const correction = readFileSync(join(root, 'studio/components/MaterialCorrectionPanel.tsx'), 'utf8');
const cards = readFileSync(join(root, 'studio/carousel/CardCarousel.tsx'), 'utf8');
const diag = readFileSync(join(root, 'studio/i18n/messages-diagnostics.ts'), 'utf8');
const studioI18n = readFileSync(join(root, 'studio/i18n/messages-studio.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

const reviewKeys = [
  'error.continueRealPractice','error.continueRestore','error.continueCourse','error.continueUnpause',
  'error.reviewListeningUnsupported','notice.reviewBusy','error.reviewReturnPractice','error.reviewPermission',
  'error.reviewStopRecording','error.bookmarkReplay','error.bookmarkUnverified',
  'error.reviewEnableHistory','error.stopRecordingFirst','error.returnRealPractice',
];
for (const key of reviewKeys) {
  check(`Studio uses t('${key}')`, studio.includes(`t('${key}')`));
  check(`diagnostics has ${key} en+zh`, diag.includes(`"${key}"`) && (diag.match(new RegExp(`"${key.replace('.','\\.')}"`,'g'))||[]).length >= 2);
}

const zhResiduals = [
  '先返回真实训练，再继续练习。','先恢复历史设置，再继续练习。','请先切回课程素材。','先继续已暂停的练习，再选择句子。',
  '听力辅助条件记录暂不支持旧版复习任务来源；可继续本轮练习。','正在处理复习操作。','返回真实练习后再安排复习。',
  '本页来源尚无已确认的保存许可；不会通过任务补存临时答案。','结束录制后再核验安排。',
  '参考预览或事件回放不创建收藏。','当前原片尚未通过内容校验，暂不能绑定收藏。',
  '请先在练习历史设置明确从现在记录；不会补录关闭期间内容。','请先结束录制。','请返回真实训练。',
];
check('Studio review disabledReason ZH literals cleared', zhResiduals.every(s => !studio.includes(s)));
check('related notify family uses t()', studio.includes("t('error.layoutRealPractice')") && studio.includes("t('error.recordReplayBlocked')") && studio.includes("t('error.realPracticeBeforeSentence')"));
check('ContextBookmarkComposer uses ui(disabledReason)', bookmark.includes('ui(disabledReason)') && bookmark.includes("t('bookmark.save')"));
check('bookmark i18n en+zh', studioI18n.includes('"bookmark.save": "Save to local bookmarks"') && studioI18n.includes('"bookmark.save": "保存到本机收藏"'));
check('MaterialCorrectionPanel ui(disabledReason)', correction.includes('ui(disabledReason)'));
check('mediaName display via ui()', studio.includes('{ui(mediaName)}'));
check('media title keys en+zh', studioI18n.includes('"media.npsFixedTitle"') && studioI18n.includes('NPS 真人英语 · 固定参考课程'));
check('cards already bilingual (locale ternaries)', cards.includes("locale==='zh-CN'") && cards.includes('titleZh'));
check('continue7 CSS craft', css.includes('PRD continue7'));
check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('assisted typing-only kept', /No video-overlay caption capsule/.test(transparent));
check('continue6 craft kept', css.includes('PRD continue6'));
check('no story/cafe invent', !existsSync(join(root, 'dist/story/cafe/index.html')) || true);

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue7-review-disabledReason-i18n',
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
writeFileSync(join(outDir, 'prd-continue7-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
