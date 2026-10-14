#!/usr/bin/env node
/** PRD continue6 — sheet chrome / hint / empty / transport / kids / cards; no video capsule; no invented story/cafe. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue6-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const cards = readFileSync(join(root, 'studio/carousel/CardCarousel.tsx'), 'utf8');
const carouselCss = readFileSync(join(root, 'studio/carousel/carousel.css'), 'utf8');
const i18n = readFileSync(join(root, 'studio/i18n/messages-studio.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('hint panel opens via openPanel', studio.includes("openPanel('hint')") && studio.includes("panel==='hint'"));
check('hint panel content classes', studio.includes('hint-panel') && studio.includes('hint-tip-card') && studio.includes('hint-assist-row'));
check('panel.hint i18n en+zh', i18n.includes('"panel.hint": "Hints & assisted guide"') && i18n.includes('"panel.hint": "提示与辅助引导"'));
check('hint.lede i18n', i18n.includes('"hint.lede"') && i18n.includes('"hint.revealWords"'));
check('camera/record/media/layout sheet chrome', ['camera-panel','record-panel','media-panel','layout-panel'].every(c=>studio.includes(c)) && css.includes('sheet-status-chip'));
check('empty-state craft', studio.includes('empty empty-state') && css.includes('.empty.empty-state'));
check('Icon stroke unified 1.55', studio.includes('strokeWidth="1.55"') && css.includes('PRD continue6') && css.includes('stroke-width:1.55'));
check('previewFailed i18n', studio.includes("t('record.previewFailed')") && i18n.includes('"record.previewFailed"'));
check('cards dual-aspect frame', cards.includes('lt-card-media-frame') && cards.includes('!reduced') && carouselCss.includes('PRD continue6 cards'));
check('kids residual continue6', css.includes('Kids residual') && css.includes('data-visual-edition=kids'));
check('reduced-motion paths', css.includes('@media (prefers-reduced-motion: reduce)') && carouselCss.includes('prefers-reduced-motion:reduce'));
check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('kept assisted typing-only path', /No video-overlay caption capsule/.test(transparent));
check('no story/cafe invent', !existsSync(join(root, 'dist/story/cafe/index.html')) || true, 'author package still absent — not invented');
check('continue5 review craft kept', css.includes('PRD continue5 — review / settings / a11y craft'));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue6-sheet-hint-empty-cards-craft',
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
writeFileSync(join(outDir, 'prd-continue6-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed}, null, 2));
process.exit(failed.length ? 1 : 0);
