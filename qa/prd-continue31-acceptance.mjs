#!/usr/bin/env node
/** PRD continue31 — Studio ZH residuals → t()/catalog + edition-switch chrome; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue31-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const diag = readFileSync(join(root, 'studio/i18n/messages-diagnostics.ts'), 'utf8');
const scene = readFileSync(join(root, 'studio/i18n/messages-scene.ts'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');
const palette = readFileSync(join(root, 'studio/scene/video-palette.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('presentation status uses t(listenHidden)', studio.includes("t('studio.listenHiddenStatus')"));
check('presentation status uses t(listenReference)', studio.includes("t('studio.listenReferenceStatus')"));
check('presentation status uses t(standby)', studio.includes("t('studio.standbyStatus')"));
check('presentation status uses t(live)', studio.includes("t('studio.liveStatus')"));
check('presentation status uses t(replay)', studio.includes("t('studio.eventReplayStatus')"));
check('presentation status uses t(awaiting)', studio.includes("t('studio.awaitingStats')"));
check('no ui() ZH presentationStatus ternary', !/ui\(presentationStatus===/.test(studio));
check('mediaName init via t(npsFixedTitle)', studio.includes("useState(()=>t('media.npsFixedTitle'))"));
check('beforeUnload via t(pendingLocalSave)', studio.includes("e.returnValue=t('error.pendingLocalSave')"));
check('diagnostics palette.closedDefault en+zh', diag.split('"palette.closedDefault"').length - 1 >= 2);
check('palette.closedDefault ZH exact', diag.includes('"palette.closedDefault": "已关闭，使用默认配色。"'));
check('palette INITIAL keeps ZH-canonical', palette.includes("message: '已关闭，使用默认配色。'"));
check('scene livePausedDetail catalog', scene.includes("'scene.livePausedDetail'") && scene.includes('练习已暂停，已获得成果保留'));
check('scene liveActiveDetail catalog', scene.includes("'scene.liveActiveDetail'") && scene.includes('正在显示本轮实际统计'));
check('scene noScorable/awaiting/standby catalog', scene.includes("'scene.noScorableDetail'") && scene.includes("'scene.awaitingPracticeDetail'") && scene.includes("'scene.standbyDetail'"));
check('CSS continue31 edition-switch marker', /continue31 — edition-switch chrome residual/.test(css));
check('CSS edition-switch glass peer', /\.edition-switch\{[\s\S]*backdrop-filter:blur\(12px\)/.test(css));
check('prior continue30 kept', /continue30 — typing-follow-toggle \/ pace-chip residual/.test(css));
check('OS keyboard / Enter / cafe / dictation / follow / camera20 kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE'))
  && studio.includes('toggleKeyboard')
  && (/max-width:20px;max-height:20px/.test(css) || /reinforce camera glyph peer size lock/.test(css))
  && /No video-overlay caption capsule/.test(transparent)
  && /continue22 — input-card plate/.test(inputCard)
  && /breathScale:1\.48/.test(kids));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue31-zh-residuals-edition-switch',
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
    'studio.listenHiddenStatus','studio.listenReferenceStatus','studio.standbyStatus','studio.liveStatus','studio.eventReplayStatus','studio.awaitingStats',
    'media.npsFixedTitle','error.pendingLocalSave','palette.closedDefault',
    'scene.livePausedDetail','scene.liveActiveDetail','scene.noScorableDetail','scene.awaitingPracticeDetail','scene.standbyDetail','scene.standbyRestoredSuffix','scene.training',
  ],
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue31-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
