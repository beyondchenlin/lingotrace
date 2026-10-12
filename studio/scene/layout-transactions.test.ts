import test from 'node:test';
import assert from 'node:assert/strict';
import {LayoutTransactions,type LayoutConfiguration} from './layout-transactions';
const original:LayoutConfiguration={layout:'lesson',arrangement:{inset:{x:1300,y:250,w:240,h:152}}};
const changed:LayoutConfiguration={layout:'split',arrangement:{inset:{x:1000,y:100,w:300,h:190}}};
const landscape={portrait:false,height:1080};
test('preview is isolated, cancel restores exact original configuration, no implicit apply',()=>{
 const t=new LayoutTransactions();t.begin(original,landscape);assert.equal(t.active,true);const preview=t.preview(changed)!;assert.deepEqual(preview,changed);assert.equal(t.canUndo(changed,false),false);assert.deepEqual(t.cancel(),original);assert.equal(t.active,false);assert.equal(t.apply(),null);assert.deepEqual(original.arrangement.inset,{x:1300,y:250,w:240,h:152});
});
test('apply followed by one undo restores both arrangement and mode exactly',()=>{
 const t=new LayoutTransactions();t.begin(original,landscape);t.preview(changed);assert.deepEqual(t.apply(),changed);assert.equal(t.canUndo(changed,false),true);assert.deepEqual(t.undo(changed,false),original);assert.equal(t.undo(original,false),null);
});
test('only last effective application is undoable and unchanged apply keeps it',()=>{
 const t=new LayoutTransactions();t.begin(original,landscape);t.preview(changed);t.apply();t.begin(changed,landscape);t.apply();assert.deepEqual(t.undo(changed,false),original);
});
test('canceling another preview does not erase existing undo',()=>{
 const t=new LayoutTransactions();t.begin(original,landscape);t.preview(changed);t.apply();t.begin(changed,landscape);t.preview({layout:'lesson',arrangement:{}});assert.equal(t.undo(changed,false),null);assert.deepEqual(t.cancel(),changed);assert.deepEqual(t.undo(changed,false),original);
});
test('separate orientation histories never overwrite each other or compare by timestamp',()=>{
 const t=new LayoutTransactions();t.begin(original,landscape);t.preview(changed);t.apply();const p={layout:'lesson',arrangement:{}} as const;t.begin(p,{portrait:true,height:900});const pc=t.preview({layout:'lesson',arrangement:{inset:{x:10,y:10,w:120,h:100}}})!;t.apply();assert.equal(t.canUndo(pc,false),false);assert.deepEqual(t.undo(pc,true),p);assert.deepEqual(t.undo(changed,false),original);
});
test('out of band changed configuration cannot be overwritten by undo',()=>{
 const t=new LayoutTransactions();t.begin(original,landscape);t.preview(changed);t.apply();assert.equal(t.undo({...changed,layout:'camera'},false),null);assert.equal(t.undo(original,false),null);assert.deepEqual(t.undo(changed,false),original);
});
test('bound geometry normalization is shared and mutation aliases cannot alter captured baseline',()=>{
 const start=structuredClone(original),t=new LayoutTransactions();t.begin(start,landscape);start.arrangement.inset!.x=1;const next=t.preview({layout:'lesson',arrangement:{inset:{x:-100,y:9999,w:99999,h:99999}}})!;assert.ok(next.arrangement.inset!.x>=0);assert.ok(next.arrangement.inset!.y+next.arrangement.inset!.h<=724);next.arrangement.inset!.x=50;assert.notEqual(t.apply()!.arrangement.inset!.x,50);assert.deepEqual(t.undo(t.preview(changed)??{layout:'lesson',arrangement:{}},false),null);
});
test('cancel after orientation/height interruption restores the original without migrating it',()=>{
 const t=new LayoutTransactions();t.begin(original,{portrait:true,height:900});t.preview(changed);assert.deepEqual(t.context,{portrait:true,height:900});assert.deepEqual(t.cancel(),original);assert.equal(t.context,null);assert.equal(t.preview(changed),null);
});
test('nested preview refuses to silently replace original baseline',()=>{
 const t=new LayoutTransactions();t.begin(original,landscape);assert.throws(()=>t.begin(changed,landscape));assert.deepEqual(t.cancel(),original);
});
