import test from 'node:test';
import assert from 'node:assert/strict';
import {editionSurface,normalizeVisualEdition,readVisualEdition,writeVisualEdition,KIDS_EDITION,PRO_EDITION} from './kids-cartoon';

test('kids edition keeps distinct glanceable accents without dropping HUD roles',()=>{
 assert.equal(editionSurface('pro').id,'pro');
 assert.equal(editionSurface('kids').id,'kids');
 assert.notEqual(KIDS_EDITION.tone,PRO_EDITION.tone);
 assert.ok(KIDS_EDITION.plateRadius>PRO_EDITION.plateRadius);
 assert.ok(KIDS_EDITION.breathScale>PRO_EDITION.breathScale);
 assert.ok(KIDS_EDITION.warmLift>PRO_EDITION.warmLift);
 assert.equal(normalizeVisualEdition('kids'),'kids');
 assert.equal(normalizeVisualEdition('nope'),'pro');
});

test('visual edition preference round-trips through storage helpers',()=>{
 const store=new Map<string,string>();
 const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v)}};
 assert.equal(readVisualEdition(storage),'pro');
 assert.equal(writeVisualEdition(storage,'kids'),true);
 assert.equal(readVisualEdition(storage),'kids');
});
