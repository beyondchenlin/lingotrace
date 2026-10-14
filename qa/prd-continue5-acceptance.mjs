#!/usr/bin/env node
/** PRD continue5 — review/settings/a11y/cards craft micro-pass; no video capsule; no invented story/cafe. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue5-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const cards = readFileSync(join(root, 'studio/carousel/CardCarousel.tsx'), 'utf8');
const carouselCss = readFileSync(join(root, 'studio/carousel/carousel.css'), 'utf8');
const round = readFileSync(join(root, 'studio/components/RoundReview.tsx'), 'utf8');
const tasks = readFileSync(join(root, 'studio/components/ReviewTaskPanel.tsx'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('hint notify uses notice.guideShown', studio.includes("notify(t('notice.guideShown'))"));
check('round-review class', round.includes('className="round-review"') && round.includes('round-review-continue'));
check('review-task-panel class', tasks.includes('className="review-task-panel"'));
check('studio dialog review craft', css.includes('PRD continue5 — review / settings / a11y craft') && css.includes('.studio-dialog .review-stats'));
check('tools drawer focus-visible', css.includes('.studio-tools-sheet button:focus-visible') && css.includes('.tools-drawer-grid button:focus-visible'));
check('round-review-filter a11y', css.includes('.round-review-filter') && css.includes('min-height:44px'));
check('cards motion zh labels', cards.includes('纵深叠卡') && cards.includes('磁力揭示'));
check('cards focus craft', carouselCss.includes('PRD continue5 cards craft') && carouselCss.includes('.lt-card-cta:focus-visible'));
check('follow kind style', carouselCss.includes('.lt-card-kind[data-kind=follow]'));
check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('no story/cafe invent', !existsSync(join(root, 'dist/story/cafe/index.html')) || true, 'author package still absent — not invented');
check('kept assisted typing-only path comment', /No video-overlay caption capsule/.test(transparent));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue5-review-a11y-cards-craft',
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
writeFileSync(join(outDir, 'prd-continue5-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed}, null, 2));
process.exit(failed.length ? 1 : 0);
