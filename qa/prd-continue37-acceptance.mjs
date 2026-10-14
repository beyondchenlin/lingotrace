#!/usr/bin/env node
/** PRD continue37 — reason.* protocol enum + leftover Studio catalog bridges. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue37-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const reason = readFileSync(join(root, 'studio/core/record-stop-reason.ts'), 'utf8');
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const recorder = readFileSync(join(root, 'studio/media/scene-recorder.ts'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const nps = readFileSync(join(root, 'studio/components/NpsTransportCheck.tsx'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');
const portrait = readFileSync(join(root, 'studio/scene/portrait-blackout-host.test.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('RECORD_STOP_REASON.userStop ZH-canonical', reason.includes("userStop: '用户停止'"));
check('RECORD_STOP_REASON.practicePaused', reason.includes("practicePaused: '练习暂停'"));
check('RECORD_STOP_REASON.mixInterrupted', reason.includes("mixInterrupted: '录制混音中断'"));
check('RECORD_STOP_REASON.renderInterrupted', reason.includes("renderInterrupted: '画面渲染中断'"));
check('RECORD_STOP_REASON.backgrounded', reason.includes("backgrounded: '页面后台化'"));
check('RECORD_STOP_REASON_KEYS map reason.*', reason.includes("'reason.recordUserStop'") && reason.includes("'reason.recordBackgrounded'") && reason.includes("'reason.recordMixInterrupted'") && reason.includes("'reason.recordRenderInterrupted'") && reason.includes("'reason.recordPracticePaused'"));
check('recordStopReasonKey helper', reason.includes('export function recordStopReasonKey'));
check('Studio imports RECORD_STOP_REASON', (studio.includes("from '../core/record-stop-reason'") || studio.includes("from'../core/record-stop-reason'")) && studio.includes('RECORD_STOP_REASON'));
check('Studio no hard reason ZH lits', !/'(用户停止|练习暂停|录制混音中断|画面渲染中断|页面后台化)'/.test(studio));
check('Studio stopRecording uses enum default', studio.includes('reason:RecordStopReason=RECORD_STOP_REASON.userStop'));
check('Studio compares RECORD_STOP_REASON.backgrounded', studio.includes('reason===RECORD_STOP_REASON.backgrounded'));
check('scene-recorder uses RECORD_STOP_REASON', recorder.includes('RECORD_STOP_REASON') && recorder.includes('stop(reason: RecordStopReason'));
check('scene-recorder failure messages from enum map', recorder.includes('RECORD_STOP_FAILURE_MESSAGE'));
check('Studio leftover retest bridges', studio.includes("t('error.retestOriginalTimeoutShort'") && studio.includes("t('error.retestOriginalTimeout'") && studio.includes("t('error.reviewDurationTaskMismatch'") && studio.includes("t('error.reviewOriginalDecode'") && studio.includes("t('notice.retestTrackingCue'"));
check('portrait test expects enum call', portrait.includes('RECORD_STOP_REASON') && portrait.includes('renderInterrupted'));
check('prior continue36 transport glass kept', /PRD continue36 — media-transport-check glass peer/.test(nps));
check('prior continue36 throw t() kept', (studio.match(/throw Error\(t\('/g) || []).length >= 60);
check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('OS keyboard / cafe / dictation / follow / camera20 kept',
  studio.includes('dictation') && studio.includes('follow') && (studio.includes('cafe') || studio.includes('CAFE'))
  && studio.includes('toggleKeyboard')
  && (/max-width:20px;max-height:20px/.test(css) || /reinforce camera glyph peer size lock/.test(css))
  && /continue22 — input-card plate/.test(inputCard)
  && /breathScale:1\.48/.test(kids));
check('protocol values unchanged (ZH still in enum module)', /用户停止/.test(reason) && /页面后台化/.test(reason));

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue37-record-stop-reason-enum',
  sha,
  phoneAudioVerified: false,
  videoCaptionCapsule: false,
  assistedReferenceInTypingOnly: true,
  storyCafeWired: false,
  f08PracticeDurationContract: false,
  checks,
  passed: failed.length === 0,
  failed: failed.map((c) => c.name),
  reasonKeys: ['reason.recordUserStop','reason.recordPracticePaused','reason.recordMixInterrupted','reason.recordRenderInterrupted','reason.recordBackgrounded'],
  skipped: ['F08 practice-duration contract', '/story/cafe/ author assets', 'admin/onboarding IA', 'phone audio Follow', 'cafe adaptive Follow'],
  liveExpectation: 'lingotrace-delta via claim+assign_alias',
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue37-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
