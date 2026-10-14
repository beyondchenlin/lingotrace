#!/usr/bin/env node
/** PRD continue34 — NpsTransportCheck controller ZH → t(npsTransport.*); /cards Depth+Magnetic glass peer. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue34-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const nps = readFileSync(join(root, 'studio/components/NpsTransportCheck.tsx'), 'utf8');
const panels = readFileSync(join(root, 'studio/i18n/messages-panels.ts'), 'utf8');
const carousel = readFileSync(join(root, 'studio/carousel/carousel.css'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');
const editor = readFileSync(join(root, 'studio/components/LayoutEditor.tsx'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('controller accepts optional t', nps.includes('t?: TransportT') && nps.includes("options.t ?? defaultT"));
check('controller defaultT zh-CN', nps.includes("translate('zh-CN', key, params)"));
check('controller t(errFallback)', nps.includes("t('npsTransport.errFallback')"));
check('controller t(errSourceOrDurationChanged)', nps.includes("t('npsTransport.errSourceOrDurationChanged'"));
check('controller t(errVerifySha)', nps.includes("t('npsTransport.errVerifySha')"));
check('controller t(errNativeDecodeDetails)', nps.includes("t('npsTransport.errNativeDecodeDetails'"));
check('controller t(errDurationTimeout)', nps.includes("t('npsTransport.errDurationTimeout')"));
check('controller t(errMetadataMismatchDetails)', nps.includes("t('npsTransport.errMetadataMismatchDetails'"));
check('controller t(nativeErrorCode)', nps.includes("t('npsTransport.nativeErrorCode'"));
check('controller t(canvasSuccess/Fail)', nps.includes("t('npsTransport.canvasSuccess'") && nps.includes("t('npsTransport.canvasFail'"));
check('Inner passes t into controller', nps.includes('changed: setState, t }') || nps.includes('changed: setState, t}'));
check('no hard-coded ZH error/canvas lits in controller', !/原生视频来源不符|画布读取成功|等待原生时长超时|视频检查失败，请手动重试/.test(nps));
check('catalog nativeErrorCode EN+ZH', panels.includes('"npsTransport.nativeErrorCode"') && (panels.match(/npsTransport\.nativeErrorCode/g) || []).length >= 2);
check('cards continue34 depth-deck frost', /PRD continue34 cards/.test(carousel) && /data-motion=depth-deck.*\n[\s\S]*?backdrop-filter:blur\(22px\)/.test(carousel));
check('cards continue34 magnetic-reveal frost', /data-motion=magnetic-reveal.*\n[\s\S]*?backdrop-filter:blur\(22px\) saturate\(1\.18\)/.test(carousel) || /magnetic-reveal\] \.lt-card\.is-active\{[\s\S]*?backdrop-filter:blur\(22px\)/.test(carousel));
check('cards hairline peer #d7e7d8', /depth-deck.*#d7e7d8|magnetic-reveal.*#d7e7d8/.test(carousel.replace(/\n/g,' ')));
check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('prior continue33 reviewTask t() kept', studio.includes("t('reviewTask.refOriginal')") && studio.includes("t('reviewTask.resultNone')"));
check('prior continue32 LayoutEditor t() kept', editor.includes("t('layoutEditor.title')") && editor.includes('useStudioLocale'));
check('OS keyboard / cafe / dictation / follow / camera20 / craft kept',
  studio.includes('dictation') && studio.includes('follow') && (studio.includes('cafe') || studio.includes('CAFE'))
  && studio.includes('toggleKeyboard')
  && (/max-width:20px;max-height:20px/.test(css) || /reinforce camera glyph peer size lock/.test(css))
  && /continue22 — input-card plate/.test(inputCard)
  && /breathScale:1\.48/.test(kids)
  && /continue31 — edition-switch chrome residual/.test(css));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue34-nps-transport-t-cards-glass',
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
    'npsTransport.errFallback','npsTransport.errSourceOrDurationChanged','npsTransport.errVerifySha','npsTransport.errDirectCreds',
    'npsTransport.errNativeDecodeDetails','npsTransport.errSourceMismatchDetails','npsTransport.errDurationTimeout',
    'npsTransport.errMetadataTimeoutReady','npsTransport.errMetadataMismatchDetails','npsTransport.errMetadataTimeout',
    'npsTransport.errSourceMismatch','npsTransport.errNativeDecode','npsTransport.nativeErrorCode',
    'npsTransport.canvasSuccess','npsTransport.canvasFail','npsTransport.canvasNotDecoded',
  ],
  cardsOptical: ['depth-deck frost/hairline peer', 'magnetic-reveal frost/hairline peer'],
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue34-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
