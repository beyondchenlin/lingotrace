import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordingFailureMessage } from './recording-error-message.ts';

test('quota objects and DOMExceptions show the same readable recovery message', () => {
  const diagnostic = Object.freeze({code:'QuotaExceededError',message:'private path /private/video',details:{token:'secret'},stack:'internal stack'});
  const expected = '本机录像存储空间不足，录制已停止。已写入的片段仍在本机，可在“本机录像”中尝试下载；片段可能无法播放。';
  assert.equal(recordingFailureMessage(diagnostic, 401189), expected);
  assert.equal(recordingFailureMessage(new DOMException('private raw message', 'QuotaExceededError'), 401189), expected);
  assert.equal(recordingFailureMessage('QuotaExceededError', 401189), expected);
  assert.equal(diagnostic.message, 'private path /private/video'); // Diagnostic is retained, not mutated.
});

test('arbitrary objects, strings and errors never expose raw diagnostic contents', () => {
  for (const error of ['secret token', '{"code":"QuotaExceededError","token":"secret"}', new Error('secret path'), {code:'toString',message:'secret'}, null, undefined]) {
    const text = recordingFailureMessage(error, 5);
    assert.match(text, /录像未能正常完成/);
    assert.match(text, /尝试下载.*可能无法播放/);
    assert.doesNotMatch(text, /secret|token|path|toString|\{|\}|undefined|null/);
  }
});

test('zero or invalid committed bytes do not promise that a recording was preserved', () => {
  for (const bytes of [0,-1,NaN,Infinity]) {
    const text = recordingFailureMessage({code:'QuotaExceededError'}, bytes);
    assert.match(text, /尚未确认有已写入且可下载/);
    assert.doesNotMatch(text, /片段仍在本机/);
  }
  assert.match(recordingFailureMessage({code:'FINALIZE_TIMEOUT'}, 1), /收尾.*片段仍在本机/);
});

test('malformed diagnostic getters cannot crash the notice or run message serialization', () => {
  const error = {get code(){throw Error('private')}, name:'QuotaExceededError', get message(){throw Error('must not read')}, toJSON(){throw Error('must not serialize')}};
  assert.match(recordingFailureMessage(error, 1), /本机录像存储空间不足/);
});

test('mix interruption is readable without exposing raw diagnostics or promising empty data',()=>{const error={code:'AUDIO_MIX_INTERRUPTED',message:'private raw device'};assert.match(recordingFailureMessage(error,8),/混音已中断.*声音可能不完整.*片段仍在本机/);assert.match(recordingFailureMessage(error,0),/尚未确认/);assert.doesNotMatch(recordingFailureMessage(error,8),/private|device/)});

test('background interruption uses safe recovery text and never exposes device diagnostics',()=>{const error={code:'PAGE_BACKGROUND_INTERRUPTED',message:'private device'};assert.match(recordingFailureMessage(error,8),/进入后台.*录像已中断.*片段仍在本机/);assert.match(recordingFailureMessage(error,0),/尚未确认/);assert.doesNotMatch(recordingFailureMessage(error,8),/private|device/)});
