import test from 'node:test';
import assert from 'node:assert/strict';
import {carouselMotion,DEMO_LESSON_CARDS,DEPTH_DECK,MAGNETIC_REVEAL} from './motions';

test('both carousel motions stay distinct and reduced-motion friendly by timing alone',()=>{
 assert.equal(carouselMotion('depth-deck').id,'depth-deck');
 assert.equal(carouselMotion('magnetic-reveal').id,'magnetic-reveal');
 assert.ok(MAGNETIC_REVEAL.snapOvershoot>DEPTH_DECK.snapOvershoot);
 assert.ok(MAGNETIC_REVEAL.focusScale>=DEPTH_DECK.focusScale);
});

test('demo deck includes landscape and portrait cards with practice hrefs',()=>{
 assert.ok(DEMO_LESSON_CARDS.some(c=>c.aspect==='landscape'));
 assert.ok(DEMO_LESSON_CARDS.some(c=>c.aspect==='portrait'));
 for(const card of DEMO_LESSON_CARDS){
  assert.ok(card.posterSrc.startsWith('/studio-assets/'));
  assert.equal(card.href,'/studio/');
 }
});
