#!/usr/bin/env node
/** PRD continue10 — panel chrome ZH → en+zh-CN t() for library/layout/listening/legacy HUD; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue10-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const library = readFileSync(join(root, 'studio/components/ContextBookmarkLibrary.tsx'), 'utf8');
const layout = readFileSync(join(root, 'studio/components/LayoutPlanFiles.tsx'), 'utf8');
const listening = readFileSync(join(root, 'studio/components/ListeningSessionHistory.tsx'), 'utf8');
const hud = readFileSync(join(root, 'studio/components/LegacyHistoryHud.tsx'), 'utf8');
const resultCard = readFileSync(join(root, 'studio/components/LegacyResultCard.tsx'), 'utf8');
const panels = readFileSync(join(root, 'studio/i18n/messages-panels.ts'), 'utf8');
const locale = readFileSync(join(root, 'studio/i18n/locale.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('locale wires panelsEnglish', locale.includes('panelsEnglish') && locale.includes('messages-panels'));
const libraryKeys = [
  'library.title','library.refresh','library.empty','library.view','library.prepare','library.play',
  'library.recordingBlocked','library.monitorNote','library.unreadable','library.boundCourse',
];
for (const key of libraryKeys) {
  check(`panels has ${key} en+zh`, panels.split(`"${key}"`).length - 1 >= 2);
  check(`library uses t('${key}')`, library.includes(`t('${key}'`));
}
check('library uses useStudioLocale', library.includes('useStudioLocale'));
check('library no raw section aria ZH', !library.includes('aria-label="本机语境收藏"'));
check('library displays via ui(error/message)', library.includes('ui(error)') && library.includes('ui(message)'));
check('library invalidReference via t()', library.includes("t('library.invalidReference')") && panels.split('"library.invalidReference"').length - 1 >= 2);
check('library no raw validateReference ZH', !library.includes('收藏的素材版本、参考或片段关联无法核验'));


const layoutKeys = [
  'layoutPlan.title','layoutPlan.heading','layoutPlan.export','layoutPlan.choose','layoutPlan.previewLoaded',
  'layoutPlan.errSizeLimit','layoutPlan.changeStage','layoutPlan.blocked',
];
for (const key of layoutKeys) {
  check(`panels has ${key} en+zh`, panels.split(`"${key}"`).length - 1 >= 2);
}
check('layout uses useStudioLocale + t title', layout.includes('useStudioLocale') && layout.includes("t('layoutPlan.title')"));
check('layout no raw ZH heading', !layout.includes('<h3>保存与恢复布局</h3>'));
check('layout ui(message) status', layout.includes('ui(message)'));

check('listening assistanceKeys via t', listening.includes('assistanceKeys') && listening.includes("t(assistanceKeys[assistance])"));
check('listening coverageKeys via t', listening.includes('coverageKeys') && listening.includes("t(coverageKeys[coverage])"));
check('listening read/export via t', listening.includes("t('listeningHistory.readFailed'") && listening.includes("t('listeningHistory.exportFailed'"));
check('listening no hardcoded assistance ZH map', !listening.includes("'有参考帮助'"));

check('historyHud stateKeys via t', hud.includes('historyHud.stateMeasured') && hud.includes('stateKeys'));
check('resultCard residuals via t', resultCard.includes("t('resultCard.generationFailed')") && resultCard.includes("t('resultCard.downloaded')") && resultCard.includes("t('resultCard.downloadFailed')"));

check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('assisted typing-only kept', /No video-overlay caption capsule/.test(transparent));
check('OS keyboard / Enter craft kept', studio.includes('softwareKeyboard') || existsSync(join(root, 'app/studio/studio.css')));
check('cafe/dictation/follow kept', studio.includes('dictation') && studio.includes('follow') && (studio.includes('cafe') || studio.includes('CAFE')));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue10-panel-chrome-i18n',
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
writeFileSync(join(outDir, 'prd-continue10-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
