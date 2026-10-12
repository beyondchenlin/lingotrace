import {parseResponsiveArrangement} from './responsive-editor';
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportLayoutPlan,parseLayoutPlan,validateLayoutPlan,layoutPlanChanges,MAX_LAYOUT_PLAN_BYTES} from './layout-plan-file';
import {LayoutTransactions,type LayoutConfiguration} from './layout-transactions';
const context={portrait:false,height:1080},original:LayoutConfiguration={layout:'lesson',arrangement:{inset:{x:1300,y:250,w:240,h:152}}};
const text=exportLayoutPlan(original,context),base=()=>JSON.parse(text);
test('versioned geometry roundtrip preserves exact config with no training/media fields',()=>{assert.deepEqual(parseLayoutPlan(text,context),original);assert.deepEqual(Object.keys(base()).sort(),['canvas','configuration','orientation','schemaVersion']);assert.doesNotMatch(text,/draft|answer|attempt|reference|mediaId|URL|score|audio/)});
test('portrait has an explicit logical height and no silent orientation or height migration',()=>{const p={portrait:true,height:940},value={layout:'lesson',arrangement:{inset:{x:200,y:100,w:100,h:80}}}as const;const t=exportLayoutPlan(value,p);assert.deepEqual(parseLayoutPlan(t,p),value);assert.throws(()=>parseLayoutPlan(t,context),/方向/);assert.throws(()=>parseLayoutPlan(t,{...p,height:820}),/画布/)});
test('empty defaults and each allowed mode roundtrip, without invented rectangles',()=>{for(const layout of ['lesson','camera','split']as const)assert.deepEqual(parseLayoutPlan(exportLayoutPlan({layout,arrangement:{}},context),context),{layout,arrangement:{}})});
test('unknown versions, root/config/canvas/item/coordinate fields and missing fields rejected',()=>{
 for(const mutate of [(x:any)=>x.schemaVersion='v2',(x:any)=>x.unexpected=1,(x:any)=>x.configuration.url='https://example.com',(x:any)=>x.canvas.dpr=2,(x:any)=>x.configuration.arrangement.foo={},(x:any)=>x.configuration.arrangement.inset.code='alert(1)',(x:any)=>delete x.configuration.layout]){const raw=base();mutate(raw);assert.throws(()=>parseLayoutPlan(JSON.stringify(raw),context));}
});
test('prototype pollution keys and escaped/duplicate keys rejected at all depths',()=>{
 for(const bad of [text.replace('"schemaVersion":','"schemaVersion":"bad","schemaVersion":'),text.replace('"arrangement": {','"arrangement": {"__proto__": {},'),text.replace('"arrangement": {','"arrangement": {"constructor": {},'),text.replace('"arrangement": {','"arrangement": {"prototype": {},'),text.replace('"x": 1300','"x": 1,"\\u0078": 1300')])assert.throws(()=>parseLayoutPlan(bad,context));
 assert.equal(({}as any).polluted,undefined);
});
test('strings containing punctuation or object-shaped code cannot execute or masquerade as config',()=>{for(const value of ['{}',[],null,{...base(),configuration:'(()=>alert(1))()'},{...base(),configuration:{...original,layout:'javascript:alert(1)'}}])assert.throws(()=>validateLayoutPlan(value,context))});
test('finite positive sizes and original existing geometry safety constraints enforced without clamping import',()=>{
 for(const patch of [{x:-1},{y:1000},{w:0},{h:-1},{w:50000},{x:'0'},{x:null},{x:Infinity},{h:NaN}]){const raw=base();Object.assign(raw.configuration.arrangement.inset,patch);assert.throws(()=>validateLayoutPlan(raw,context));}
 assert.throws(()=>parseLayoutPlan(text.replace('1300','1e400'),context));
});
test('size cap is UTF8 bytes and invalid JSON is explicit; no file beyond bound parsed',()=>{assert.throws(()=>parseLayoutPlan(' '.repeat(MAX_LAYOUT_PLAN_BYTES+1),context),/64 KiB/);assert.throws(()=>parseLayoutPlan('语'.repeat(22000),context),/64 KiB/);assert.throws(()=>parseLayoutPlan('{',context),/有效 JSON/)});
test('accessors and inherited shapes rejected without invoking supplied getter',()=>{let reads=0;const raw=base();Object.defineProperty(raw,'configuration',{get(){reads++;return original}});assert.throws(()=>validateLayoutPlan(raw,context));assert.equal(reads,0);assert.throws(()=>validateLayoutPlan(Object.create(base()),context))});
test('difference summary reflects only supported changed components/mode',()=>{assert.deepEqual(layoutPlanChanges(original,original),[]);assert.deepEqual(layoutPlanChanges(original,{layout:'split',arrangement:{}}),['舞台主次','小窗'])});
test('export while previewing captures applied baseline and imported candidate remains undoable',()=>{const tx=new LayoutTransactions();tx.begin(original,context);const next=tx.preview({layout:'lesson',arrangement:{}})!;assert.deepEqual(parseLayoutPlan(exportLayoutPlan(tx.original!,context),context),original);assert.deepEqual(tx.apply(),next);assert.deepEqual(tx.undo(next,false),original)});
test('invalid import leaves current candidate, baseline and original preference untouched',()=>{const tx=new LayoutTransactions();tx.begin(original,context);tx.preview({layout:'lesson',arrangement:{}});assert.throws(()=>parseLayoutPlan('{"url":"evil"}',context));assert.deepEqual(tx.original,original);assert.deepEqual(tx.cancel(),original)});
test('subnormal dimensions and overflowing aspect ratios cannot become zero-sized after preview',()=>{for(const patch of [{w:180,h:Number.MIN_VALUE},{w:Number.MIN_VALUE,h:180}]){const raw=base();Object.assign(raw.configuration.arrangement.inset,patch);assert.throws(()=>validateLayoutPlan(raw,context));}});

test('existing normalized portrait boundary geometry remains portable despite coordinate rounding',()=>{const c={portrait:true,height:820},arrangement=parseResponsiveArrangement({inset:{x:721.3034365326166,y:244.89823961630464,w:46.89464429393411,h:830.5195004213601}},true,820),config={layout:'lesson',arrangement}as const;assert.deepEqual(parseLayoutPlan(exportLayoutPlan(config,c),c),config)});
