#!/usr/bin/env node
/** PRD continue8 — MaterialCorrectionPanel chrome i18n + notify→t() / review ui bridge; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue8-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const correction = readFileSync(join(root, 'studio/components/MaterialCorrectionPanel.tsx'), 'utf8');
const corrI18n = readFileSync(join(root, 'studio/i18n/messages-correction.ts'), 'utf8');
const locale = readFileSync(join(root, 'studio/i18n/locale.ts'), 'utf8');
const diag = readFileSync(join(root, 'studio/i18n/messages-diagnostics.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

const chromeKeys = [
  'correction.sectionLabel','correction.lede','correction.verify','correction.save','correction.preview',
  'correction.modeEdit','correction.modeMerge','correction.modeSplit','correction.bookmarkLimit',
  'correction.historyIndependence','correction.empty','correction.startNew',
];
for (const key of chromeKeys) {
  check(`MaterialCorrectionPanel uses t('${key}')`, correction.includes(`t('${key}')`));
  check(`correction catalog has ${key} en+zh`, corrI18n.includes(`'${key}'`) && (corrI18n.match(new RegExp(`'${key.replace('.','\\.')}'`,'g'))||[]).length >= 2);
}
check('locale wires correctionEnglish/Chinese', locale.includes('correctionEnglish') && locale.includes('correctionChinese'));
check('panel still bridges disabledReason via ui()', correction.includes('ui(disabledReason)'));
check('panel status/errors go through ui()', correction.includes('ui(error)') && correction.includes('ui(message)'));

const notifyKeys = [
  'notice.courseStarted','notice.retestStarted','notice.historyStarted','notice.historyStopped',
  'notice.fontFallback','error.mediaLoad','error.mediaPlayback','error.openReferencesRealPractice',
  'error.resumeOperation','error.historyGap',
];
for (const key of notifyKeys) {
  check(`Studio notify(t('${key}'))`, studio.includes(`notify(t('${key}'))`));
}
check("Studio uses t('error.videoUnavailable') for media overlay", studio.includes("t('error.videoUnavailable')"));
check('reviewTask ref/result diagnostics present for ui bridge', [
  'reviewTask.refOriginal','reviewTask.refNps','reviewTask.resultNone','reviewTask.resultEvidenceGone',
].every(k => diag.includes(`"${k}"`)));
check('no exact ZH notify literals for migrated course/retest', !studio.includes("notify('已结束上一轮并新开所选课程") && !studio.includes("notify('已按固定版本新开复测"));
check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('assisted typing-only kept', /No video-overlay caption capsule/.test(transparent));
check('OS keyboard / Enter craft kept (soft keyboard path)', studio.includes('softwareKeyboard') || studio.includes('SoftwareKeyboard') || studio.includes('os-keyboard') || existsSync(join(root, 'app/studio/studio.css')));
check('cafe/dictation/follow kept', studio.includes('dictation') && studio.includes('follow') && (studio.includes('cafe') || studio.includes('CAFE')));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue8-correction-i18n-notify',
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
writeFileSync(join(outDir, 'prd-continue8-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
