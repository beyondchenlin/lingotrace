import test from 'node:test';
import assert from 'node:assert/strict';
import * as input from './input-card';
const display={text:'',lines:[{start:0,end:0,text:'',x:8,y:6,width:0,height:24,baseline:25}],selection:[],caret:{x:8,y:6,w:1.5,h:24},scrollLeft:0,scrollTop:0,width:320,height:60,font:'20px monospace',letterSpacing:0,lineHeight:24,paddingX:8,paddingY:6};
test('long empty assisted scaffold supplies a real bounded scroll range without modifying the native value',()=>{
 const before=JSON.stringify(display),plan=input.inputViewportPlan(display,60,300,240,false);
 assert.equal(plan.contentHeight,300);assert.equal(plan.scrollTop,240);assert.equal(plan.viewportHeight,60);assert.equal(JSON.stringify(display),before);
});
test('manual scaffold scrolling stays put until a real editing or selection action asks to reveal the caret',()=>{
 assert.equal(input.inputViewportPlan(display,60,300,150,false).scrollTop,150);
 assert.equal(input.inputViewportPlan(display,60,300,150,true).scrollTop,6);
});
test('typed multiline content defines range and selection caret stays reachable independently of guidance',()=>{
 const value={...display,text:'full long native draft',lines:[...display.lines,{start:1,end:22,text:'full long native draft',x:8,y:270,width:160,height:24,baseline:289}],caret:{x:160,y:270,w:1.5,h:24}};
 const plan=input.inputViewportPlan(value,60,0,0,true);assert.equal(plan.contentHeight,300);assert.equal(plan.scrollTop,234);assert.equal(value.text,'full long native draft');
 assert.equal(input.inputViewportPlan(display,60,0,240,false).scrollTop,0,'turning guidance off clamps without rewriting text');
});

test('assisted accessibility summary contains counts and never reference text',()=>{const summary=input.inputGuideSummary(input.inputGuideMask('HELLO world'));assert.match(summary,/10 letter slots and 2 word slots/);assert.match(input.inputGuideSummary(input.inputGuideMask('HELLO world'),'zh-CN'),/10 个字位、2 个词位/);assert.ok(!summary.includes('HELLO'));assert.ok(!summary.includes('world'))});
