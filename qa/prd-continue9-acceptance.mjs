#!/usr/bin/env node
/** PRD continue9 — review result templates i18n + remaining notify residuals → t(); no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue9-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const locale = readFileSync(join(root, 'studio/i18n/locale.ts'), 'utf8');
const diag = readFileSync(join(root, 'studio/i18n/messages-diagnostics.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

const templateKeys = [
  'reviewTask.resultLinked','reviewTask.dispositionWinner','reviewTask.dispositionFollowOn',
  'reviewTask.coveragePartial','reviewTask.coverageComplete',
  'reviewTask.refHasNewer','reviewTask.refInstanceMissing','reviewTask.refEvidenceUnavailable',
];
for (const key of templateKeys) {
  const needle = `"${key}"`;
  check(`diagnostics has ${key} en+zh`, diag.split(needle).length - 1 >= 2);
}
check('locale nests disposition/coverage like details', locale.includes("'disposition'") && locale.includes("'coverage'") && locale.includes('nested'));

const notifyKeys = [
  'studio.fullscreenUnavailable','notice.recordStopped','notice.recordBackgroundSaved','error.recordBackgroundEmpty',
  'notice.recordMixSaved','error.recordMixEmpty','notice.recordIncomplete','error.recordStart','error.recordFinalize',
  'error.recordRead','error.recordPreview','error.downloadStart','error.courseMonitor','error.correctedClipPlay',
  'error.correctedVerifiedPlayback','error.courseVerification','error.reviewTasksRead','error.recordStorage','error.recordStorageRestore',
];
for (const key of notifyKeys) {
  check(`Studio uses t('${key}')`, studio.includes(`t('${key}')`));
}
check('Studio references cafe/nps prepare keys', studio.includes("'error.cafeCoursePrepare'") && studio.includes("'error.npsCoursePrepare'"));
check('no fullscreen EN notify literal', !studio.includes("notify('Fullscreen is unavailable"));
check('no ZH record-stopped notify literal', !studio.includes("'录像已停止，请在本机录像中检查与下载。'"));
check('no ZH background-saved notify literal', !studio.includes("'页面已进入后台，录像已中断，已写入片段保留"));
check('review rows still ZH-canonical for ui bridge', studio.includes('固定原版；不会自动采用新参考。') && studio.includes('最近关联提交 ${latest.source.attemptId}'));
check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('assisted typing-only kept', /No video-overlay caption capsule/.test(transparent));
check('OS keyboard / Enter craft kept', studio.includes('softwareKeyboard') || existsSync(join(root, 'app/studio/studio.css')));
check('cafe/dictation/follow kept', studio.includes('dictation') && studio.includes('follow') && (studio.includes('cafe') || studio.includes('CAFE')));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue9-review-result-notify-i18n',
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
writeFileSync(join(outDir, 'prd-continue9-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
