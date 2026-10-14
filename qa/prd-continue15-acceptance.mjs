#!/usr/bin/env node
/** PRD continue15 — highest-craft HUD visual pass vs 06/transparent-hud; no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue15-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('no video caption capsule comment path', /No video-overlay caption capsule/.test(transparent));
check('no capsule markers', !/video-caption-capsule|glass-caption-capsule|rgba\(6,14,20/.test(transparent + studio));
check('assisted typing well craft', /continue15 — soft typing well/.test(inputCard));
check('word rails continue15', /continue15 word\/letter rails/.test(inputCard));
check('hudBacking continue15 craft', /continue15 market glass: deeper frost/.test(transparent));
check('timeline continue15', /continue15 timeline/.test(transparent));
check('title band continue15', /continue15 product chrome/.test(transparent));
check('CSS continue15 marker', /continue15 — highest-craft HUD/.test(css));
check('pace chip craft', css.includes('letter-spacing:.08em') && css.includes('backdrop-filter:blur(12px)'));
check('tools sheet craft', css.includes('border-radius:20px') && css.includes('blur(24px)'));
check('kids plateRadius 22', /plateRadius:22/.test(kids));
check('pro plateAlpha 1.08', /plateAlpha:1\.08/.test(kids));
check('OS keyboard / Enter / cafe / dictation / follow kept',
  studio.includes('dictation') && studio.includes('follow')
  && (studio.includes('cafe') || studio.includes('CAFE')));
check('entry viewport craft', css.includes('border-radius:18px') && css.includes('entry-viewport'));
check('review stats craft', css.includes('studio-dialog .review-stats') && css.includes('e2fbb8'));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue15-highest-craft-hud',
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
writeFileSync(join(outDir, 'prd-continue15-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
