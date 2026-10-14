#!/usr/bin/env node
/** PRD continue33 — reviewTask referenceStatus/resultSummary → t(); no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue33-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const fixture = readFileSync(join(root, 'studio/core/studio-host-test-fixture.ts'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');
const editor = readFileSync(join(root, 'studio/components/LayoutEditor.tsx'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('Studio t(reviewTask.refOriginal)', studio.includes("t('reviewTask.refOriginal')"));
check('Studio t(reviewTask.refNps)', studio.includes("t('reviewTask.refNps')"));
check('Studio t(reviewTask.refNpsUnverified)', studio.includes("t('reviewTask.refNpsUnverified')"));
check('Studio t(reviewTask.refLocalMissing)', studio.includes("t('reviewTask.refLocalMissing')"));
check('Studio t(reviewTask.refLocalFixed)', studio.includes("t('reviewTask.refLocalFixed')"));
check('Studio t(reviewTask.refHasNewer)', studio.includes("t('reviewTask.refHasNewer')"));
check('Studio t(reviewTask.refInstanceMissing)', studio.includes("t('reviewTask.refInstanceMissing')"));
check('Studio t(reviewTask.refEvidenceUnavailable)', studio.includes("t('reviewTask.refEvidenceUnavailable')"));
check('Studio t(reviewTask.resultNone)', studio.includes("t('reviewTask.resultNone')"));
check('Studio t(reviewTask.resultLinked)', studio.includes("t('reviewTask.resultLinked'"));
check('Studio disposition/coverage keys', studio.includes("'reviewTask.dispositionWinner'") && studio.includes("'reviewTask.dispositionFollowOn'") && studio.includes("'reviewTask.coveragePartial'") && studio.includes("'reviewTask.coverageComplete'"));
check('Studio t(reviewTask.resultEvidenceGone)', studio.includes("t('reviewTask.resultEvidenceGone')"));
check('Studio t(reviewTask.resultEvidenceUnread)', studio.includes("t('reviewTask.resultEvidenceUnread')"));
check('no ZH-canonical reviewTask row literals', !studio.includes("'固定原版；不会自动采用新参考。'") && !studio.includes('最近关联提交 ${') && !studio.includes("'暂无已关联的实际复测结果"));
check('stacked suffixes join with space+t()', studio.includes("referenceStatus+=' '+t('reviewTask.refHasNewer')") && studio.includes("referenceStatus+=' '+t('reviewTask.refInstanceMissing')"));
check('fixture exports resumePracticeForTyping', fixture.includes("'resumePracticeForTyping'"));
check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('prior continue32 LayoutEditor t() kept', editor.includes("t('layoutEditor.title')") && editor.includes('useStudioLocale'));
check('prior continue31 edition-switch kept', /continue31 — edition-switch chrome residual/.test(css));
check('OS keyboard / cafe / dictation / follow / camera20 kept',
  studio.includes('dictation') && studio.includes('follow') && (studio.includes('cafe') || studio.includes('CAFE'))
  && studio.includes('toggleKeyboard')
  && (/max-width:20px;max-height:20px/.test(css) || /reinforce camera glyph peer size lock/.test(css))
  && /continue22 — input-card plate/.test(inputCard)
  && /breathScale:1\.48/.test(kids));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue33-reviewtask-zh-t',
  sha,
  phoneAudioVerified: false,
  videoCaptionCapsule: false,
  assistedReferenceInTypingOnly: true,
  storyCafeWired: false,
  f08PracticeDurationContract: false,
  checks,
  passed: failed.length === 0,
  failed: failed.map((c) => c.name),
  skipped: ['F08 practice-duration contract', '/story/cafe/ author assets', 'admin/onboarding IA', 'phone audio Follow', 'cafe adaptive Follow', '/cards Depth Deck / Magnetic Reveal glass peer (fallback unused — real ZH shipped)'],
  liveExpectation: 'lingotrace-delta via claim+assign_alias',
  zhBridged: [
    'reviewTask.refOriginal','reviewTask.refNps','reviewTask.refNpsUnverified','reviewTask.refLocalMissing','reviewTask.refLocalFixed',
    'reviewTask.refHasNewer','reviewTask.refInstanceMissing','reviewTask.refEvidenceUnavailable',
    'reviewTask.resultNone','reviewTask.resultLinked','reviewTask.resultEvidenceGone','reviewTask.resultEvidenceUnread',
    'reviewTask.dispositionWinner','reviewTask.dispositionFollowOn','reviewTask.coveragePartial','reviewTask.coverageComplete',
  ],
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue33-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
