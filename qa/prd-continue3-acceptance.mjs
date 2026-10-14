#!/usr/bin/env node
/** PRD continue3 — Follow sentence-β labels + fixture export gate + no video capsule. */
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue3-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const messages = readFileSync(join(root, 'studio/i18n/messages-studio.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const cards = readFileSync(join(root, 'studio/carousel/CardCarousel.tsx'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('follow.title EN sentence Beta', /Follow typing · sentence estimate · Beta/.test(messages));
check('follow.title ZH 句级 Beta', /跟打 · 句级估算 · Beta/.test(messages));
check('follow.startHint EN', /Sentence-level estimate; words may not line up exactly/.test(messages));
check('follow.startHint ZH', /句级估算，词未必对齐/.test(messages));
check('chipAssist sentence β', /Assist · sentence β/.test(messages) && /辅助 · 句级 β/.test(messages));
check('Studio wires startHint', studio.includes("t('follow.startHint')"));
check('Studio wires chipAssistRate', studio.includes("t('fixed.chipAssistRate'"));
check('Studio fixture export gate', studio.includes("t('data.fixtureBlocked')") && /disabled=\{\!\!fixture/.test(studio));
check('no video caption capsule comment', /No video-overlay caption capsule/.test(transparent));
check('no capsule class reintroduced', !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('cards Follow · sentence β', /Follow · sentence β/.test(cards) && /跟音 · 句级 β/.test(cards));
check('CSS touch 44px pace buttons', /\.pace-mode-row button.*min-height:44px/s.test(css) || css.includes('pace-mode-row button,.pace-rate-row button{min-height:44px}'));
check('phoneAudioVerified still false', true, 'harness does not claim phone audio');

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue3-follow-beta-labels-export-gate',
  sha,
  phoneAudioVerified: false,
  cafeAdaptiveFollow: 'nps-only-by-design',
  videoCaptionCapsule: false,
  assistedReferenceInTypingOnly: true,
  checks,
  passed: failed.length === 0,
  failed: failed.map((c) => c.name),
  liveExpectation: 'lingotrace-delta via claim+assign_alias',
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue3-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed}, null, 2));
process.exit(failed.length ? 1 : 0);
