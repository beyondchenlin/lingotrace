import {translate,translateKnownUi} from '../i18n/locale';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {projectListeningHistory} from './listening-history';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc'),parser=require('next/dist/compiled/babel/parser');await swc.loadBindings();
const source=await readFile(new URL('../components/ListeningControls.tsx',import.meta.url),'utf8');
const {code}=await swc.transform(source,{jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
function render(open=true,active=true,history=true){
 const states:any[]=[2,1,history,open],calls:any[]=[],exports:any={};let index=0;
 const localRequire=(name:string)=>name==='../i18n/react'?{useStudioLocale:()=>({locale:'en',t:translate.bind(null,'en'),ui:translateKnownUi.bind(null,'en')})}:name==='react'?{useState:()=>{const i=index++;return[states[i],(v:any)=>states[i]=typeof v==='function'?v(states[i]):v]}}:name==='../core/listening-history'?{projectListeningHistory}:name==='./HudControls'?{HudGlyph:()=>null,HudPopover:()=>null}:require(name);
 new Function('require','exports',code)(localRequire,exports);
 const record={schemaVersion:'listening-history-v1',observationId:'one',writerInstanceId:'writer',materialId:'course',materialVersion:'v1',mediaId:'media',mediaSha256:'a'.repeat(64),startedAt:'2026-10-11T00:00:00Z',generation:1,revision:1,sealed:true,facts:[]};
 const action=(name:string)=>(...args:any[])=>{calls.push([name,...args]);return Promise.resolve()};
 const player=Object.fromEntries(['pause','play','repeatCurrent','continueAll','rate','showText','help','closeHelp','seek'].map(name=>[name,action(name)]));
 const control={state:active?{mode:'listen',playing:false,rate:1,textVisible:false,duration:45,position:2,helpOpen:true,observation:{identity:{runId:'run'},totals:{observed:false,gapCount:0}}}:null,playerRef:{current:player},error:'',historyError:'',storage:'临时',referenceReady:true,history:[record],start:action('start'),finish:action('finish'),retry:action('retry'),loadHistory:action('loadHistory'),exportHistory:action('exportHistory')};
 const tree=exports.default({control,download:action('download')}),nodes:any[]=[];
 const visit=(node:any)=>{if(Array.isArray(node)){node.forEach(visit);return}if(node&&typeof node==='object'){nodes.push(node);visit(node.props?.children)}};visit(tree);
 const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
 const button=(label:string)=>{const found=nodes.find(n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label));assert.ok(found,label);return found};
 return{states,calls,nodes,button,control,record};
}
test('closed HUD has only discoverable listening/history glyphs, with no top toolbar or disclosure copy',()=>{
 const f=render(false,false,false),buttons=f.nodes.filter(n=>n.type==='button');assert.equal(buttons.length,2);assert.ok(buttons.every(n=>n.props.className==='hud-glyph'));f.button('Start listening').props.onClick();assert.deepEqual(f.calls,[['start']]);assert.equal(f.states[3],true);
});
test('expanded actual HUD retains player actions, help, rate, repeats, seek, saved and temporary export',async()=>{
 const f=render();for(const key of ['listening.resume','listening.repeat','listening.continuous','listening.typeNow','listening.finish','listening.showText','listening.help','listening.closeHelp','listening.retrySave','listening.exportTemporary','listening.exportSaved'] as const)await f.button(translate('en',key)).props.onClick();
 for(const [label,value]of[[translate('en','listening.speedLabel'),'1.5'],[translate('en','listening.seek'),'12']])f.nodes.find(n=>n.props?.['aria-label']===label).props.onChange({target:{value}});
 assert.ok(f.calls.some(c=>c[0]==='repeatCurrent'&&c[1]===2&&c[2]===1));assert.ok(f.calls.some(c=>c[0]==='finish'&&c[1]===true));assert.ok(f.calls.some(c=>c[0]==='finish'&&c[1]===undefined));assert.ok(f.calls.some(c=>c[0]==='rate'&&c[1]===1.5));assert.ok(f.calls.some(c=>c[0]==='seek'&&c[1]===12));assert.ok(f.calls.some(c=>c[0]==='showText'&&c[1]===true));assert.ok(f.calls.some(c=>c[0]==='exportHistory'&&c[1]===f.record));assert.ok(f.calls.some(c=>c[0]==='download'&&c[1]==='lingotrace-listening-temporary-run.json'&&c[2] instanceof Blob));
});
test('disclosure close changes only visibility, with no listening transport or submission side effect',()=>{
 const f=render(),popover=f.nodes.find(n=>n.props?.label==='Listening');assert.ok(popover);popover.props.onClose();assert.equal(f.states[3],false);assert.deepEqual(f.calls,[]);
});
test('actual shared disclosure Escape/outside behavior is contained and cleans up listeners',async()=>{
 const hud=await readFile(new URL('../components/HudControls.tsx',import.meta.url),'utf8'),ast=parser.parse(hud,{sourceType:'module',plugins:['typescript','jsx']});let effect:any;
 const visit=(n:any)=>{if(!n||typeof n!=='object')return;if(n.type==='CallExpression'&&n.callee.name==='useEffect')effect=n.arguments[0];for(const [k,v]of Object.entries(n))if(k!=='loc'){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v)}};visit(ast);assert.ok(effect);
 const js=(await swc.transform(`const install=${hud.slice(effect.start,effect.end)}`,{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}})).code;
 const listeners=new Map<string,Function>(),trigger:any={focusCount:0,contains:(t:any)=>t===trigger,focus(){this.focusCount++}},inside={},outside={},panel={contains:(t:any)=>t===inside,querySelector:()=>({focus(){}})},document={activeElement:trigger,body:{},addEventListener:(name:string,fn:Function)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)};let closes=0;
 const cleanup=new Function('document','ref','closeRef',`${js};return install()`)(document,{current:panel},{current:()=>closes++});
 listeners.get('pointerdown')!({target:inside});listeners.get('pointerdown')!({target:trigger});assert.equal(closes,0);listeners.get('pointerdown')!({target:outside});assert.equal(closes,1);
 let prevented=0,stopped=0;listeners.get('keydown')!({key:'Enter',preventDefault(){prevented++},stopPropagation(){stopped++}});assert.equal(closes,1);listeners.get('keydown')!({key:'Escape',preventDefault(){prevented++},stopPropagation(){stopped++}});assert.equal(closes,2);assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(trigger.focusCount,1);cleanup();assert.equal(listeners.size,0);
});
