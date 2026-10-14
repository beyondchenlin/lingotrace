import test from 'node:test';
import assert from 'node:assert/strict';
import {carouselMotion,DEMO_LESSON_CARDS,DEPTH_DECK,MAGNETIC_REVEAL} from './motions';

test('both carousel motions stay distinct and reduced-motion friendly by timing alone',()=>{
 assert.equal(carouselMotion('depth-deck').id,'depth-deck');
 assert.equal(carouselMotion('magnetic-reveal').id,'magnetic-reveal');
 assert.ok(MAGNETIC_REVEAL.snapOvershoot>DEPTH_DECK.snapOvershoot);
 assert.ok(MAGNETIC_REVEAL.focusScale>=DEPTH_DECK.focusScale);
 assert.ok(MAGNETIC_REVEAL.settleMs>=DEPTH_DECK.settleMs);
});

test('richer catalog covers fixed, dictation, kids and cafe fixed-pace with dual aspect',()=>{
 assert.ok(DEMO_LESSON_CARDS.length>=6);
 assert.ok(DEMO_LESSON_CARDS.some(c=>c.aspect==='landscape'));
 assert.ok(DEMO_LESSON_CARDS.some(c=>c.aspect==='portrait'));
 const kinds=new Set(DEMO_LESSON_CARDS.map(c=>c.kind));
 for(const kind of ['fixed-pace','dictation','kids','cafe','assisted'] as const)assert.ok(kinds.has(kind),kind);
 for(const card of DEMO_LESSON_CARDS){
  assert.ok(card.posterSrc.startsWith('/studio-assets/'));
  assert.ok(card.href.startsWith('/studio/'));
  assert.ok(card.titleZh.length>0);
 }
 assert.ok(DEMO_LESSON_CARDS.some(c=>c.href.includes('dictation=1')));
 assert.ok(DEMO_LESSON_CARDS.some(c=>c.href.includes('edition=kids')));
 assert.ok(DEMO_LESSON_CARDS.some(c=>c.href.includes('course=cafe')));
 assert.ok(DEMO_LESSON_CARDS.filter(c=>c.kind==='cafe').every(c=>c.href.includes('course=cafe')));
});
