#!/usr/bin/env node
/** PRD continue32 — LayoutEditor ZH → t(); history/bookmark/layoutPlan already bridged; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue32-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const editor = readFileSync(join(root, 'studio/components/LayoutEditor.tsx'), 'utf8');
const msgs = readFileSync(join(root, 'studio/i18n/messages-studio.ts'), 'utf8');
const history = readFileSync(join(root, 'studio/components/ListeningSessionHistory.tsx'), 'utf8');
const bookmarks = readFileSync(join(root, 'studio/components/ContextBookmarkLibrary.tsx'), 'utf8');
const plan = readFileSync(join(root, 'studio/components/LayoutPlanFiles.tsx'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');
const layoutTs = readFileSync(join(root, 'studio/scene/transparent-layout.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

const zhLit = (s) => /[\u4e00-\u9fff]/.test(s);
const hardZh = (src) => [...src.matchAll(/['"`]([^'"`]*[\u4e00-\u9fff][^'"`]*)['"`]/g)].map(m => m[1]);

check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent + editor));
check('LayoutEditor uses useStudioLocale', editor.includes('useStudioLocale'));
check('LayoutEditor title via t()', editor.includes("t('layoutEditor.title')"));
check('LayoutEditor gestureCancel via t()', editor.includes("t('layoutEditor.gestureCancel')"));
check('LayoutEditor viewportCancel via t()', editor.includes("t('layoutEditor.viewportCancel')"));
check('LayoutEditor reuses layout.cancel/apply', editor.includes("t('layout.cancel')") && editor.includes("t('layout.apply')"));
check('LayoutEditor no hard-coded ZH chrome', hardZh(editor).length === 0);
check('layoutEditor.title ZH canonical', msgs.includes('"layoutEditor.title": "舞台布局编辑"'));
check('layoutEditor.inset ZH matches LAYOUT_NAMES', msgs.includes('"layoutEditor.inset": "摄像头 / 课程小窗"') && layoutTs.includes("inset:'摄像头 / 课程小窗'"));
check('layoutEditor.dockBottomRight ZH', msgs.includes('"layoutEditor.dockBottomRight": "右下"'));
check('layoutEditor.positionStatus template', msgs.includes('"layoutEditor.positionStatus": "{name}，位置{x}、{y}，大小{w}乘{h}"'));
check('ListeningSessionHistory already t()/ui()', history.includes('useStudioLocale') && history.includes("t('listeningHistory.title')") && hardZh(history).length === 0);
check('ContextBookmarkLibrary already t()/ui()', bookmarks.includes('useStudioLocale') && hardZh(bookmarks).length === 0);
check('LayoutPlanFiles already t()/ui()', plan.includes('useStudioLocale') && plan.includes("t('layoutPlan.title')") && hardZh(plan).length === 0);
check('prior continue31 edition-switch kept', /continue31 — edition-switch chrome residual/.test(css));
check('prior continue30 kept', /continue30 — typing-follow-toggle \/ pace-chip residual/.test(css));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE'))
  && studio.includes('toggleKeyboard'));
check('Assisted typing-only / no capsule craft kept', /No video-overlay caption capsule/.test(transparent));
check('camera 20px peer lock kept', /max-width:20px;max-height:20px/.test(css) || /reinforce camera glyph peer size lock/.test(css));
check('short word rails / input-card / kids breath kept',
  /continue22 — input-card plate/.test(inputCard) && /breathScale:1\.48/.test(kids));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue32-layout-editor-zh-residuals',
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
  zhBridged: [
    'layoutEditor.title','layoutEditor.adjust','layoutEditor.dock',
    'layoutEditor.dockTopLeft','layoutEditor.dockTopRight','layoutEditor.dockBottomLeft','layoutEditor.dockBottomRight',
    'layoutEditor.resetItem','layoutEditor.resetAll','layoutEditor.hint','layoutEditor.hintLandscape',
    'layoutEditor.viewportCancel','layoutEditor.gestureCancel','layoutEditor.positionStatus',
    'layoutEditor.moveAria','layoutEditor.resizeAria',
    'layoutEditor.media','layoutEditor.inset','layoutEditor.subtitle','layoutEditor.metrics',
    'layout.cancel','layout.apply',
  ],
  alreadyBridged: ['ListeningSessionHistory','ContextBookmarkLibrary','LayoutPlanFiles','layout-plan-file throws via ui()'],
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue32-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
