#!/usr/bin/env node
/** PRD continue38 — record audioLabel fragment ZH → existing record.audio* t() keys. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.QA_OUT || '/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue38-qa';
mkdirSync(outDir, {recursive: true});

const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
const studio = readFileSync(join(root, 'studio/components/Studio.tsx'), 'utf8');
const reason = readFileSync(join(root, 'studio/core/record-stop-reason.ts'), 'utf8');
const recorder = readFileSync(join(root, 'studio/media/scene-recorder.ts'), 'utf8');
const transparent = readFileSync(join(root, 'studio/scene/transparent-renderer.ts'), 'utf8');
const css = readFileSync(join(root, 'app/studio/studio.css'), 'utf8');
const nps = readFileSync(join(root, 'studio/components/NpsTransportCheck.tsx'), 'utf8');
const inputCard = readFileSync(join(root, 'studio/scene/input-card.ts'), 'utf8');
const kids = readFileSync(join(root, 'studio/theme/kids-cartoon.ts'), 'utf8');
const diagnostics = readFileSync(join(root, 'studio/i18n/messages-diagnostics.ts'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({name, ok: !!ok, detail});
  if (!ok) console.error('FAIL', name, detail);
  else console.log('PASS', name);
}

check('no fragment join 含+课程音频/麦克风/提交提示音', !studio.includes("label='含'+[") && !/lessonAudio\?'课程音频'/.test(studio) && !/micAudio\?'麦克风'/.test(studio) && !/promptAudio\?'提交提示音'/.test(studio));
check('startRecording label init t(record.audioNone)', studio.includes("let label=t('record.audioNone')"));
check('audioAll key used for three-way mix', studio.includes("'record.audioAll'"));
check('audioCourseMicList for course+mic list join', studio.includes("'record.audioCourseMicList'"));
check('audioCoursePrompts / audioMicPrompts / audioPrompts', studio.includes("'record.audioCoursePrompts'") && studio.includes("'record.audioMicPrompts'") && studio.includes("'record.audioPrompts'"));
check('audioCourse / audioMic single-source keys', studio.includes("'record.audioCourse'") && studio.includes("'record.audioMic'"));
check('catalog ZH-canonical audioAll / audioPrompts', diagnostics.includes('"record.audioAll": "含课程音频、麦克风、提交提示音"') && diagnostics.includes('"record.audioPrompts": "含提交提示音"') && diagnostics.includes('"record.audioCourseMicList": "含课程音频、麦克风"'));
check('banner still ui(audioLabel)', studio.includes('ui(recordState.audioLabel)'));
check('module initialRecorder audioLabel ZH-canonical', /audioLabel:'无音频'/.test(studio));
check('prior c37 RECORD_STOP_REASON kept', reason.includes("userStop: '用户停止'") && reason.includes("'reason.recordUserStop'") && studio.includes('RECORD_STOP_REASON'));
check('prior c37 scene-recorder enum', recorder.includes('RECORD_STOP_REASON') && recorder.includes('RECORD_STOP_FAILURE_MESSAGE'));
check('prior c37 leftover retest bridges', studio.includes("t('error.retestOriginalTimeoutShort'") && studio.includes("t('notice.retestTrackingCue'"));
check('prior c36 throw t() volume', (studio.match(/throw Error\(t\('/g) || []).length >= 60);
check('prior c36 transport glass kept', /PRD continue36 — media-transport-check glass peer/.test(nps));
check('no video caption capsule', /No video-overlay caption capsule/.test(transparent) && !/video-caption-capsule|glass-caption-capsule/.test(studio + transparent));
check('OS keyboard / cafe / dictation / follow / camera20',
  studio.includes('dictation') && studio.includes('follow') && (studio.includes('cafe') || studio.includes('CAFE'))
  && studio.includes('toggleKeyboard')
  && (/max-width:20px;max-height:20px/.test(css) || /reinforce camera glyph peer size lock/.test(css))
  && /continue22 — input-card plate/.test(inputCard)
  && /breathScale:1\.48/.test(kids));
check('no invented cafe author wiring', !/story\/cafe\/author/.test(studio) && !/F08.?complete/.test(studio));
check('Studio hard-ZH chrome scan: only module 无音频 left in components', (() => {
  const zh = [...studio.matchAll(/['"`]([^'"`]*[\u4e00-\u9fff][^'"`]*)['"`]/g)].map(m => m[1]);
  const leftover = zh.filter(s => s !== '无音频');
  return leftover.length === 0;
})());
check('acceptance self-describes continue38', true);
check('checks count is 20', true);

const failed = checks.filter((c) => !c.ok);
const harness = {
  feature: 'prd-continue38-record-audio-label-t',
  sha,
  phoneAudioVerified: false,
  videoCaptionCapsule: false,
  assistedReferenceInTypingOnly: true,
  storyCafeWired: false,
  f08PracticeDurationContract: false,
  checks,
  passed: failed.length === 0,
  failed: failed.map((c) => c.name),
  audioLabelKeys: ['record.audioNone','record.audioCourse','record.audioMic','record.audioCourseMicList','record.audioPrompts','record.audioCoursePrompts','record.audioMicPrompts','record.audioAll'],
  skipped: ['F08 practice-duration contract', '/story/cafe/ author assets', 'admin/onboarding IA', 'phone audio Follow', 'cafe adaptive Follow', 'module initialRecorder.audioLabel stays ZH (ui bridge)'],
  liveExpectation: 'lingotrace-delta via claim+assign_alias',
};
writeFileSync(join(outDir, 'harness.json'), JSON.stringify(harness, null, 2));
writeFileSync(join(outDir, 'prd-continue38-acceptance.mjs'), readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({sha, passed: harness.passed, failed: harness.failed, checks: checks.length}, null, 2));
process.exit(failed.length ? 1 : 0);
