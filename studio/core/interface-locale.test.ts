import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as localeModule from '../i18n/locale';
import {english,chinese,translate,translateKnownUi,normalizeStudioLocale,readStudioLocale,writeStudioLocale,STUDIO_LOCALE_STORAGE_KEY,type MessageKey} from '../i18n/locale';
import {TrainingEngine} from './training';
import {recordingFailureMessage} from '../media/recording-error-message';

const require=createRequire(import.meta.url);

test('English is canonical, both dictionaries cover the same semantic keys and interpolation fields',()=>{
 assert.deepEqual(Object.keys(chinese).sort(),Object.keys(english).sort());
 for(const key of Object.keys(english) as MessageKey[]){
  assert.match(key,/^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/);
  const params=(value:string)=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
  assert.deepEqual(params(english[key]),params(chinese[key]),key);
 }
 assert.equal(translate('en','hud.check'),'Check');assert.equal(translate('zh-CN','hud.check'),'确认');
 assert.equal(translate('en','hud.errorCount',{count:3}),'Errors: 3 · Review');
});

test('only an explicit supported local preference changes the English default',()=>{
 for(const value of [null,undefined,'zh','zh-TW','fr','auto','"zh-CN"'])assert.equal(normalizeStudioLocale(value),'en');
 assert.equal(normalizeStudioLocale('zh-CN'),'zh-CN');
 assert.equal(readStudioLocale(null),'en');assert.equal(readStudioLocale({getItem:()=>{throw Error('blocked')}}),'en');
 assert.equal(readStudioLocale({getItem:key=>{assert.equal(key,STUDIO_LOCALE_STORAGE_KEY);return 'zh-CN'}}),'zh-CN');
 const writes:unknown[]=[];assert.equal(writeStudioLocale({setItem:(...values)=>{writes.push(values)}},'en'),true);
 assert.deepEqual(writes,[[STUDIO_LOCALE_STORAGE_KEY,'en']]);
 assert.equal(writeStudioLocale(null,'zh-CN'),false);assert.equal(writeStudioLocale({setItem:()=>{throw Error('quota')}},'zh-CN'),false);
});

test('known diagnostics translate without altering raw failures, unknown details, or recorded facts',()=>{
 const raw=recordingFailureMessage({code:'QuotaExceededError'},1024);
 assert.match(translateKnownUi('en',raw),/storage is full.*Written segments.*may not be playable/);
 assert.match(raw,/本机录像存储空间不足/);
 assert.equal(translateKnownUi('en','总时长：3.20 秒（浏览器报告）。'),'Total duration: 3.20 seconds (reported by the browser).');
 assert.equal(translateKnownUi('en','听力条件记录读取失败：opaque error 418'),'Listening conditions could not be read: opaque error 418');
 assert.equal(translateKnownUi('zh-CN','Total duration: 3.20 seconds (reported by the browser).'),'总时长：3.20 秒（浏览器报告）。');
 assert.equal(translateKnownUi('en','Unrecognized permission failure / 9'),'Unrecognized permission failure / 9');
 assert.equal(translateKnownUi('en','未知错误，保留细节'),'未知错误，保留细节');
 const engine=new TrainingEngine();engine.input('My English draft stays exactly the same.');const before=JSON.stringify(engine.getSnapshot());
 for(const locale of ['en','zh-CN'] as const){translate(locale,'hud.check');translateKnownUi(locale,raw)}
 assert.equal(JSON.stringify(engine.getSnapshot()),before);
});

const providerSource=await readFile(new URL('../i18n/react.tsx',import.meta.url),'utf8');
const swc=require('next/dist/build/swc');await swc.loadBindings();
const {code}=await swc.transform(providerSource,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});

/** Exercise the real provider with persistent hook cells. This is not browser or full Studio QA. */
function providerHarness(saved:string|null=null,blocked=false){
 const cells:any[]=[];let cursor=0,dirty=true,tree:any;const effects:Array<()=>void>=[],writes:unknown[]=[];
 const equal=(a:any[]|undefined,b:any[]|undefined)=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const hooks={
  createContext:(value:unknown)=>({Provider:'context-provider',default:value}),
  useState:(initial:any)=>{const i=cursor++;cells[i]??={value:typeof initial==='function'?initial():initial};return[cells[i].value,(value:any)=>{const next=typeof value==='function'?value(cells[i].value):value;if(!Object.is(next,cells[i].value)){cells[i].value=next;dirty=true}}]},
  useRef:(value:any)=>{const i=cursor++;return cells[i]??={current:value}},
  useCallback:(fn:any,deps:any[])=>{const i=cursor++;if(!cells[i]||!equal(cells[i].deps,deps))cells[i]={value:fn,deps};return cells[i].value},
  useMemo:(fn:any,deps:any[])=>{const i=cursor++;if(!cells[i]||!equal(cells[i].deps,deps))cells[i]={value:fn(),deps};return cells[i].value},
  useEffect:(effect:()=>void,deps:any[])=>{const i=cursor++;if(!cells[i]||!equal(cells[i].deps,deps)){cells[i]={deps};effects.push(effect)}},
 };
 const document={documentElement:{lang:'en'}},storage={getItem:()=>saved,setItem:(key:string,value:string)=>{if(blocked)throw Error('blocked');writes.push([key,value]);saved=value}};
 const exports:any={};vm.runInNewContext(code,{exports,window:{localStorage:storage},document,require:(name:string)=>name==='react'?hooks:name==='./locale'?localeModule:require(name),navigator:new Proxy({},{get(){throw Error('browser locale must not be consulted')}})});
 const practiceChild={type:'practice-owner',props:{course:'fixed-course',draft:'untouched',attempt:'same-attempt',media:'same-media',recording:'same-recorder'}};
 function render(){cursor=0;dirty=false;tree=exports.StudioLocaleProvider({children:practiceChild});return tree}
 function settle(){let turns=0;while(dirty||effects.length){if(++turns>20)throw Error('effect loop');if(dirty)render();const queued=effects.splice(0);queued.forEach(effect=>effect())}return tree}
 return{render,settle,get value(){return tree.props.value},get tree(){return tree},practiceChild,document,writes};
}

test('locale provider updates DOM language and stable translation callbacks without replacing the practice subtree',()=>{
 const p=providerHarness();const initial=p.render();assert.equal(initial.props.value.locale,'en');p.settle();
 const t=p.value.t,ui=p.value.ui,child=p.tree.props.children;
 p.value.setLocale('zh-CN');p.settle();assert.equal(p.value.locale,'zh-CN');assert.equal(p.document.documentElement.lang,'zh-CN');assert.equal(p.value.t,t);assert.equal(p.value.ui,ui);assert.equal(t('hud.check'),'确认');assert.equal(p.tree.props.children,child);assert.equal(p.tree.key,null);
 p.value.setLocale('en');p.settle();assert.equal(p.document.documentElement.lang,'en');assert.equal(t('hud.check'),'Check');assert.equal(p.tree.props.children,p.practiceChild);
 assert.deepEqual(p.writes,[[STUDIO_LOCALE_STORAGE_KEY,'zh-CN'],[STUDIO_LOCALE_STORAGE_KEY,'en']]);
});

test('saved preference restores after English SSR; failed persistence changes this visit only',()=>{
 const saved=providerHarness('zh-CN');assert.equal(saved.render().props.value.locale,'en');saved.settle();assert.equal(saved.value.locale,'zh-CN');assert.equal(saved.document.documentElement.lang,'zh-CN');assert.equal(saved.writes.length,0);
 const blocked=providerHarness(null,true);blocked.settle();blocked.value.setLocale('zh-CN');blocked.settle();assert.equal(blocked.value.locale,'zh-CN');assert.equal(blocked.value.preferenceSaved,false);assert.equal(blocked.tree.props.children,blocked.practiceChild);
});

test('camera failure prefix localizes while known and unknown permission detail stays truthful',()=>{
 const raw='摄像头未开启：Unrecognized camera error 418';assert.equal(translateKnownUi('en',raw),'Camera did not start: Unrecognized camera error 418');assert.equal(raw,'摄像头未开启：Unrecognized camera error 418');
 assert.equal(translateKnownUi('zh-CN','Camera did not start: Unrecognized camera error 418'),raw);
 assert.equal(translateKnownUi('en','摄像头未开启：课程音频尚未准备。'),'Camera did not start: '+translateKnownUi('en','课程音频尚未准备。'));
});


test('course and retest notices describe the existing Show/Hide choice in both locales', async()=>{
 const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
 for(const key of ['media.courseChangeNotice','notice.courseStarted','notice.retestStarted'] as const){
  const en=translate('en',key),zh=translate('zh-CN',key);
  assert.match(en,/follows your Show\/Hide setting/);assert.match(en,/visible reference counts as assisted practice/);
  assert.match(zh,/参考显示遵循你的“显示\/隐藏”选择/);assert.match(zh,/展示参考计入辅助练习/);
  assert.doesNotMatch(en,/reference (?:stays|remains) hidden/i);assert.doesNotMatch(zh,/参考(?:文字)?保持隐藏/);
  assert.equal(translateKnownUi('en',zh),en);assert.equal(translateKnownUi('zh-CN',en),zh);
 }
 assert.match(translate('en','media.courseChangeNotice'),/Saved records stay intact.*Export temporary content.*does not start playback/);
 assert.match(translate('zh-CN','media.courseChangeNotice'),/已保存记录保留.*临时内容.*不会自动播放/);
 assert.match(translate('en','notice.courseStarted'),/Existing records are unchanged/);
 assert.match(translate('zh-CN','notice.courseStarted'),/旧记录不会追改/);
 assert.match(translate('en','notice.retestStarted'),/only after an actual submission/);
 assert.match(translate('zh-CN','notice.retestStarted'),/实际提交后才更新复习安排/);
 for(const key of ['notice.courseStarted','notice.retestStarted'] as const)assert.ok(source.includes(`notify(t('${key}'))`));
 assert.match(source,/\[referenceVisible,setReferenceVisible\]=useState\(true\)/);
});

test('background recording diagnostics translate both ways without changing safe recovery facts',()=>{
 for(const key of ['error.recordBackground','notice.recordBackgroundSaved','error.recordBackgroundEmpty','record.failureBackground'] as const){
  assert.equal(translateKnownUi('en',translate('zh-CN',key)),translate('en',key));
  assert.equal(translateKnownUi('zh-CN',translate('en',key)),translate('zh-CN',key));
 }
 const raw=recordingFailureMessage({code:'PAGE_BACKGROUND_INTERRUPTED',message:'private device'},8);
 assert.match(translateKnownUi('en',raw),/background.*incomplete.*Written segments/);
 assert.doesNotMatch(translateKnownUi('en',raw),/private device/);
 assert.match(translate('en','notice.recordBackgroundSaved'),/Returning will not restart/);
 assert.match(translate('en','error.recordBackgroundEmpty'),/No written recording data has been confirmed/);
});

test('review-task linked result template and suffixes translate both ways via ui bridge',()=>{
 const attemptId='attempt-qa-42';
 const words=11, errors=2;
 const disposition=translate('zh-CN','reviewTask.dispositionWinner');
 const coverage=translate('zh-CN','reviewTask.coveragePartial');
 const zh=translate('zh-CN','reviewTask.resultLinked',{attemptId,words,errors,disposition,coverage});
 const en=translate('en','reviewTask.resultLinked',{
  attemptId,words,errors,
  disposition:translate('en','reviewTask.dispositionWinner'),
  coverage:translate('en','reviewTask.coveragePartial'),
 });
 assert.match(zh,/部分记录/);assert.ok(zh.includes(attemptId));
 assert.equal(translateKnownUi('en',zh),en);
 assert.equal(translateKnownUi('zh-CN',en),zh);
 for(const key of ['reviewTask.refHasNewer','reviewTask.refInstanceMissing','reviewTask.refEvidenceUnavailable','reviewTask.resultNone'] as const){
  assert.equal(translateKnownUi('en',translate('zh-CN',key)),translate('en',key));
  assert.equal(translateKnownUi('zh-CN',translate('en',key)),translate('zh-CN',key));
 }
 const stacked=translate('zh-CN','reviewTask.refOriginal')+' '+translate('zh-CN','reviewTask.refHasNewer');
 assert.match(translateKnownUi('en',stacked),/Fixed original.*newer version/s);
});

test('continue9 Studio notify residuals use t() for recording/fullscreen/course prepare',async()=>{
 const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
 for(const key of ['studio.fullscreenUnavailable','notice.recordStopped','notice.recordBackgroundSaved','error.recordBackgroundEmpty','notice.recordMixSaved','error.recordMixEmpty','notice.recordIncomplete','error.recordStart','error.recordFinalize','error.recordRead','error.recordPreview','error.downloadStart','error.courseMonitor','error.correctedClipPlay','error.correctedVerifiedPlayback','error.courseVerification','error.reviewTasksRead','error.recordStorage','error.recordStorageRestore'] as const){
  assert.ok(source.includes(`t('${key}')`),key);
 }
 assert.ok(source.includes("'error.cafeCoursePrepare'")&&source.includes("'error.npsCoursePrepare'"));
 assert.ok(!source.includes("notify('Fullscreen is unavailable"));
 assert.ok(!source.includes("'页面已进入后台，录像已中断，已写入片段保留"));
 assert.ok(!source.includes("'录像已停止，请在本机录像中检查与下载。'"));
});
