import test from 'node:test';
import assert from 'node:assert/strict';
import {translate} from './locale.ts';
import {readFileSync} from 'node:fs';

const locales = ['en', 'zh-CN'] as const;

test('Follow controls consistently name sentence-level Beta in EN and ZH', () => {
  for (const locale of locales) {
    const title = translate(locale, 'follow.title');
    const start = translate(locale, 'follow.start');
    const assist = translate(locale, 'fixed.assist');
    const chip = translate(locale, 'fixed.chipAssist');
    const tip = translate(locale, 'follow.deepLinkTip');
    const hint = translate(locale, 'follow.startHint');
    if (locale === 'en') {
      assert.match(title, /sentence estimate/i);
      assert.match(title, /Beta/i);
      assert.match(start, /sentence/i);
      assert.match(assist, /sentence/i);
      assert.match(chip, /sentence/i);
      assert.match(tip, /sentence-level/i);
      assert.match(hint, /Sentence-level estimate/i);
      assert.match(hint, /words may not line up/i);
    } else {
      assert.match(title, /句级/);
      assert.match(title, /Beta/);
      assert.match(start, /句级/);
      assert.match(assist, /句级/);
      assert.match(chip, /句级/);
      assert.match(tip, /句级/);
      assert.match(hint, /句级估算/);
    }
  }
});

test('Studio keeps assisted reference in typing only and never reintroduces a video caption capsule', () => {
  const studio = readFileSync(new URL('../components/Studio.tsx', import.meta.url), 'utf8');
  const transparent = readFileSync(new URL('../scene/transparent-renderer.ts', import.meta.url), 'utf8');
  assert.match(transparent, /No video-overlay caption capsule/);
  assert.doesNotMatch(studio, /video-caption-capsule|glass-caption-capsule|mediaCaptionCapsule/);
  assert.match(studio, /follow\.startHint/);
  assert.match(studio, /data\.fixtureBlocked/);
  assert.match(studio, /fixed\.chipAssistRate/);
});

test('export gate copy blocks fixture downloads', () => {
  assert.match(translate('en', 'data.fixtureBlocked'), /unscored|cannot export/i);
  assert.match(translate('zh-CN', 'data.fixtureBlocked'), /不计分|不能导出/);
});
