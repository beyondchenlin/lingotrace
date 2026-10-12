import test from 'node:test';import assert from 'node:assert/strict';import {commitInput,emptyInputSample,inputScene,insertedGraphemes,setInputPaused} from '../showcase/input-model.ts';import {validateScene} from '../validate.ts';import {COMPONENT_TYPES} from '../showcase/fixtures.ts';
test('grapheme deltas handle Unicode, selection replacement and deletion',()=>{assert.equal(insertedGraphemes('','👩‍💻'),1);assert.equal(insertedGraphemes('ab','a语b'),1);assert.equal(insertedGraphemes('hello','ho'),0);assert.equal(insertedGraphemes('cat','cot'),1);});
test('committed IME counts once, paste and deletion add no effort',()=>{
  let s=emptyInputSample(0);s=commitInput(s,'hi','typed',10);assert.equal(s.total,2);s=commitInput(s,'hi语','ime',20);assert.equal(s.total,3);const same=commitInput(s,'hi语','typed',20);assert.equal(same,s);
  s=commitInput(s,'hi语 pasted text','paste',30);assert.equal(s.total,3);s=commitInput(s,'h','delete',40);assert.equal(s.total,3);assert.equal(s.events.length,4);
});
test('pause creates explicit trend gaps, blocks input and resumes without inventing elapsed input',()=>{
  let s=commitInput(emptyInputSample(0),'a','typed',10);s=setInputPaused(s,true,20);assert.equal(s.points.at(-1)?.value,null);assert.throws(()=>commitInput(s,'ab','typed',30),/paused/);
  s=setInputPaused(s,false,40);s=commitInput(s,'ab','typed',50);assert.equal(s.total,2);assert.deepEqual(s.points.map(p=>p.value),[1,null,null,2]);
});
test('all real-input frames are valid with exact measured sources and no user-database adapter',()=>{let s=emptyInputSample(0);s=commitInput(s,'hello','typed',20);for(const type of COMPONENT_TYPES){const scene=inputScene(type,s,40);assert.deepEqual(validateScene(scene,{nowMs:40,reducedMotion:false}),[]);assert.ok(Object.values(scene.metrics).every(m=>m.source==='input-event'&&m.quality==='measured'));}});
test('negative/backward clocks and oversized input are rejected; reset is empty',()=>{assert.throws(()=>emptyInputSample(-1));const s=commitInput(emptyInputSample(0),'a','typed',10);assert.throws(()=>commitInput(s,'ab','typed',9));assert.throws(()=>commitInput(s,'a'.repeat(10001),'typed',11));assert.equal(emptyInputSample(100).events.length,0);});
test('static/low-motion host frames freeze idle trend windows while new input stays observable',()=>{
  let s=commitInput(emptyInputSample(0),'abc','typed',10000);
  assert.deepEqual(inputScene('trend-line',s,31000,{freezeTimeline:true}),inputScene('trend-line',s,90000,{freezeTimeline:true}));
  s=commitInput(s,'abcd','typed',100000);const frame=inputScene('trend-line',s,100000,{freezeTimeline:true});const m=Object.values(frame.metrics)[0];assert.equal(m.kind,'trend');if(m.kind==='trend')assert.equal(m.points.at(-1)?.value,4);
});
import {classifyInputType} from '../showcase/input-model.ts';
test('undo, redo, drops and replacement do not become typed effort',()=>{
  assert.equal(classifyInputType('insertText'),'typed');assert.equal(classifyInputType('insertFromPaste'),'paste');assert.equal(classifyInputType('deleteContentBackward'),'delete');
  for(const type of ['historyUndo','historyRedo','insertFromDrop','insertReplacementText','insertCompositionText','']){
    const source=classifyInputType(type);assert.equal(source,'other');const s=commitInput(emptyInputSample(0),'restored text',source,10);assert.equal(s.total,0);assert.equal(s.text,'restored text');
  }
});
