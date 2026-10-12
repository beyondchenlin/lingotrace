import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ASSET_MANIFEST,ASR_INFO,validateResourceManifest,loadPublicResources,verifyCompleteResources,createVerifiedModelCache,createVerifiedWasmAdapterSource} from '../../public/subtitle-workbench/resources.js';

const origin='https://local.invalid/subtitle-workbench/';
const prefix='/subtitle-workbench/assets/test-immutable';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const pieces=[new Uint8Array([1,2,3]),new Uint8Array([4,5,6])];
  const full=new Uint8Array([1,2,3,4,5,6]);
  const file={key:'model/config.json',kind:'model',file:'config.json',bytes:6,sha256:hash(full),parts:pieces.map((data,index)=>({index,offset:index*3,bytes:3,sha256:hash(data),url:`${prefix}/piece${index}`}))};
  return {pieces,full,plan:{prefix,model:'fixed/model',totalBytes:6,files:[file]}};
}
function fetcher(pieces,requests=[]) {return async (url,options)=>{requests.push({url,options});return new Response(pieces[Number(url.at(-1))]);};}
const options=({plan,pieces},extra={})=>({plan,baseURL:origin,fetchImpl:fetcher(pieces),cryptoImpl:webcrypto,...extra});

test('fixed production inventory, byte totals and all deployed hashes including exact licenses',async()=>{
  assert.equal(ASSET_MANIFEST.files.length,11);assert.equal(ASSET_MANIFEST.totalBytes,66032855);
  assert.equal(ASR_INFO.modelBytes+ASR_INFO.runtimeBytes,ASR_INFO.totalBytes);
  assert.equal(ASR_INFO.revision,'aeaa13760958b03fac5062f457d317d3319c3168');
  validateResourceManifest(ASSET_MANIFEST,origin);
  let total=0;
  for(const file of ASSET_MANIFEST.files) {
    const pieces=[];
    for(const part of file.parts) {
      const path=new URL(`../../public${part.url}`,import.meta.url);const bytes=await readFile(path);
      assert.equal(bytes.length,part.bytes);assert.equal(hash(bytes),part.sha256);assert.ok(bytes.length<25*1024*1024);pieces.push(bytes);
    }
    const full=Buffer.concat(pieces);assert.equal(full.length,file.bytes);assert.equal(hash(full),file.sha256);total+=file.bytes;
  }
  assert.equal(total,66032855);
  const decoder=ASSET_MANIFEST.files.find(f=>f.file.includes('decoder_model'));
  assert.deepEqual(decoder.parts.map(p=>p.bytes),[8388608,8388608,8388608,5564057]);
  assert.equal(decoder.sha256,'f2df67fbe1cf39c9b050d05029b55e217a9467f3453ae5110e2bcc0f5ba73652');
  for(const notice of ASSET_MANIFEST.notices){const bytes=await readFile(new URL(`../../public${notice.url}`,import.meta.url));assert.equal(hash(bytes),notice.sha256);assert.equal(bytes.length,notice.bytes);}
  assert.ok(ASSET_MANIFEST.notices.some(n=>n.file==='onnxruntime-ThirdPartyNotices.txt'));
  assert.ok(ASSET_MANIFEST.notices.some(n=>n.file==='jinja-LICENSE.txt'));
  const base=await readFile(new URL('../../public/subtitle-workbench/assets/notices/base-model-README.md',import.meta.url),'utf8');assert.match(base,/license: apache-2.0/);
  const attribution=await readFile(new URL('../../public/subtitle-workbench/assets/notices/ATTRIBUTION.txt',import.meta.url),'utf8');assert.match(attribution,/OpenAI Whisper code and weights are MIT/);assert.match(attribution,/base card states Apache-2.0/);
});

test('stream download reports actual bytes, verifies parts and reconstructed full digest',async()=>{
  const f=fixture(),requests=[],progress=[];
  const result=await loadPublicResources(options(f,{fetchImpl:fetcher(f.pieces,requests),onProgress:p=>progress.push(p)}));
  assert.deepEqual(result.resources.get('model/config.json'),f.full);assert.equal(result.downloadBytes,6);assert.equal(result.cachedAssets,false);
  assert.deepEqual(progress.filter(p=>p.stage==='download'&&p.loadedBytes>0).map(p=>p.loadedBytes),[3,3,6]);
  for(const {url,options} of requests){assert.ok(url.startsWith('https://local.invalid/'));assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.mode,'same-origin');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.body,undefined);}
  assert.ok(progress.filter(p=>p.stage==='verify').every(p=>p.indeterminate));
  await verifyCompleteResources(result.resources,{plan:f.plan,cryptoImpl:webcrypto});
});

test('manifest refuses reordered, missing, duplicate and gapped pieces before any request',async()=>{
  for(const mutate of [p=>p.files[0].parts.reverse(),p=>p.files[0].parts.pop(),p=>p.files[0].parts[1].offset++,p=>p.files.push(p.files[0]),p=>p.files[0].parts[1].url=p.files[0].parts[0].url]) {
    const f=fixture();mutate(f.plan);let calls=0;
    await assert.rejects(loadPublicResources(options(f,{fetchImpl:()=>{calls++;}})),e=>e.code.startsWith('MANIFEST')||e.code==='ORIGIN');assert.equal(calls,0);
  }
});

test('correct parts with wrong full digest fail before cache admission',async()=>{
  const f=fixture(),cache=new Map();f.plan.files[0].sha256='0'.repeat(64);
  await assert.rejects(loadPublicResources(options(f,{cache})),e=>e.code==='RESOURCE_HASH'&&e.file==='model/config.json');assert.equal(cache.size,0);
});

test('bad, wrong-sized and missing parts fail without fallback',async()=>{
  for(const [response,code] of [[new Response(new Uint8Array([0,0,0])),'RESOURCE_HASH'],[new Response(new Uint8Array([1,2])),'RESOURCE_SIZE'],[new Response(new Uint8Array([1,2,3,4])),'RESOURCE_SIZE'],[new Response('missing',{status:404}),'RESOURCE_MISSING']]) {
    const f=fixture();let calls=0;const cache=new Map();
    await assert.rejects(loadPublicResources(options(f,{cache,fetchImpl:async()=>{calls++;return response;}})),e=>e.code===code);assert.equal(calls,1);assert.equal(cache.size,0);
  }
});

test('cross-origin and query URLs rejected before fetch; redirects rejected after fetch',async()=>{
  for(const url of ['https://evil.invalid/file',`${prefix}/piece0?private=name`,`${prefix}/../outside`]){
    const f=fixture();f.plan.files[0].parts[0].url=url;let calls=0;
    await assert.rejects(loadPublicResources(options(f,{fetchImpl:()=>{calls++;}})),e=>e.code==='ORIGIN');assert.equal(calls,0);
  }
  const f=fixture(),response=new Response(f.pieces[0]);Object.defineProperty(response,'redirected',{value:true});
  await assert.rejects(loadPublicResources(options(f,{fetchImpl:async()=>response})),e=>e.code==='RESOURCE_REDIRECT');
});

test('aborting an in-flight download cancels the exact fetch and cannot admit a late result',async()=>{
  const f=fixture(),controller=new AbortController(),cache=new Map();let resolveFetch,observedSignal;
  const run=loadPublicResources(options(f,{cache,signal:controller.signal,fetchImpl:async(_,options)=>{observedSignal=options.signal;return new Promise(resolve=>{resolveFetch=resolve;});}}));
  controller.abort();resolveFetch(new Response(f.pieces[0]));
  await assert.rejects(run,{name:'AbortError'});assert.equal(observedSignal.aborted,true);assert.equal(cache.size,0);
});

test('late run ownership fails before bytes become usable',async()=>{
  const f=fixture();let current=true;const cache=new Map();
  await assert.rejects(loadPublicResources(options(f,{cache,isCurrent:()=>current,onProgress:p=>{if(p.stage==='verify')current=false;}})),{name:'AbortError'});assert.equal(cache.size,0);
});

test('warm RAM hits are rehashed per resource; corrupt cache is rejected then evicted',async()=>{
  const f=fixture(),cache=new Map([['model/config.json',f.full.slice()]]),progress=[];let calls=0;
  const result=await loadPublicResources(options(f,{cache,fetchImpl:()=>{calls++;},onProgress:p=>progress.push(p)}));
  assert.equal(result.cachedAssets,true);assert.equal(result.downloadBytes,0);assert.equal(calls,0);assert.ok(progress.every(p=>p.stage==='verify'&&p.cacheHit));
  cache.get('model/config.json')[0]=99;
  await assert.rejects(loadPublicResources(options(f,{cache,fetchImpl:()=>{calls++;}})),e=>e.code==='RESOURCE_HASH');assert.equal(cache.size,0);assert.equal(calls,0);
});

test('cancelling warm verification does not evict public resources admitted by a newer run',async()=>{
  const f=fixture(),original=f.full.slice(),replacement=f.full.slice(),cache=new Map([['model/config.json',original]]);
  let resolveDigest,current=true;
  const cryptoImpl={subtle:{digest:()=>new Promise(resolve=>{resolveDigest=resolve;})}};
  const run=loadPublicResources(options(f,{cache,isCurrent:()=>current,cryptoImpl}));
  current=false;cache.set('model/config.json',replacement);
  resolveDigest(await webcrypto.subtle.digest('SHA-256',original));
  await assert.rejects(run,{name:'AbortError'});assert.equal(cache.get('model/config.json'),replacement);
});

test('Worker second gate rejects incomplete/full-corrupted resource sets',async()=>{
  const f=fixture();await assert.rejects(verifyCompleteResources(new Map(),{plan:f.plan}),e=>e.code==='RESOURCE_MISSING');
  await assert.rejects(verifyCompleteResources(new Map([['model/config.json',new Uint8Array(6)]]),{plan:f.plan,cryptoImpl:webcrypto}),e=>e.code==='RESOURCE_HASH');
});

test('documented customCache provides fresh responses and fails outside swallowed match on misses',async()=>{
  const f=fixture(),resources=new Map([['model/config.json',f.full]]),cache=createVerifiedModelCache(resources,{plan:f.plan,baseURL:origin});
  const path=`${cache.modelBase}${f.plan.model}/config.json`;
  for(let i=0;i<2;i++)assert.deepEqual(new Uint8Array(await (await cache.match(path)).arrayBuffer()),f.full);
  // Mirrors Transformers 3.7.1 tryCache: match exceptions would be swallowed. A returned
  // Response is found even when its body errors, so no local or remote fetch occurs.
  let fallback=0;
  const tryCache=async key=>{try{return await cache.match(key);}catch{return undefined;}};
  const response=await tryCache(`${cache.modelBase}${f.plan.model}/missing.json`);
  if(response===undefined)fallback++;
  await assert.rejects(response.arrayBuffer(),e=>e.code==='RESOURCE_UNAPPROVED');assert.equal(fallback,0);assert.equal(cache.misses.length,1);
  await assert.rejects(cache.put(path,new Response(f.full)),e=>e.code==='RESOURCE_CACHE_WRITE');
});

test('production Worker has mandatory pre-pipeline gate, fixed profile and no storage/upload',async()=>{
  const source=await readFile(new URL('../../public/subtitle-workbench/asr-worker.js',import.meta.url),'utf8');
  assert.ok(source.indexOf('await verifyCompleteResources(resources)')<source.indexOf("await import(makeModule"));
  assert.ok(source.indexOf('await verifyCompleteResources(resources)')<source.indexOf("await pipeline("));
  for(const required of ['env.allowRemoteModels=false','env.useFS=false','env.useFSCache=false','env.useBrowserCache=false','env.useCustomCache=true','env.backends.onnx.wasm.numThreads=1',"device:'wasm',dtype:'q8',local_files_only:true","return_timestamps:'word'",'chunk_length_s:30','stride_length_s:5','wasm.wasmBinary=resources.get'])assert.ok(source.includes(required),required);
  assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|sendBeacon|indexedDB|localStorage|caches\.open|['"]POST['"]|console\./);
});

test('client abort is immediate, terminates inference Worker, ignores late A and protects B',async()=>{
  const oldFetch=globalThis.fetch,oldWorker=globalThis.Worker,oldLocation=globalThis.location;
  const workers=[];let networkCalls=0;
  globalThis.location={href:origin};
  globalThis.fetch=async(url,options)=>{networkCalls++;assert.equal(options.method,'GET');const pathname=new URL(url).pathname;return new Response(await readFile(new URL(`../../public${pathname}`,import.meta.url)));};
  class FakeWorker {
    constructor(){workers.push(this);this.terminated=false;}
    postMessage(message){this.message=message;}
    terminate(){this.terminated=true;}
    result(output){this.onmessage({data:{type:'result',runId:this.message.runId,result:{output,workerVerifySeconds:0}}});}
  }
  globalThis.Worker=FakeWorker;
  const {runAsr,getResourceStatus,clearAsrResources}=await import('../../public/subtitle-workbench/asr-client.js');
  try{
    const pcm=new Float32Array(160);const controller=new AbortController();let aSettled=false;
    const a=runAsr(pcm,{signal:controller.signal}).catch(e=>{aSettled=true;return e;});
    while(!workers[0]?.message)await new Promise(r=>setTimeout(r,5));
    controller.abort();await Promise.resolve();assert.equal(aSettled,true);assert.equal((await a).name,'AbortError');assert.equal(workers[0].terminated,true);assert.equal(pcm.byteLength,640);
    const networkAfterA=networkCalls;const b=runAsr(pcm);
    while(!workers[1]?.message)await new Promise(r=>setTimeout(r,5));
    workers[0].result({text:'late A'});workers[1].result({text:'B'});
    const result=await b;assert.equal(result.output.text,'B');assert.equal(result.cachedAssets,true);assert.equal(networkCalls,networkAfterA);assert.equal(workers[1].terminated,true);
    assert.equal(getResourceStatus().complete,true);assert.equal(getResourceStatus().persistent,false);
    assert.equal(clearAsrResources().verifiedBytes,0);
    const cancelled=new AbortController();cancelled.abort();await assert.rejects(runAsr(pcm,{signal:cancelled.signal}),{name:'AbortError'});assert.equal(workers.length,2);
    await assert.rejects(runAsr(new Float32Array([NaN])),e=>e.code==='PCM_INVALID');
    globalThis.fetch=async()=>new Response('missing',{status:404});
    await assert.rejects(runAsr(pcm),e=>e.code==='RESOURCE_MISSING');assert.equal(workers.length,2);assert.equal(getResourceStatus().verifiedBytes,0);
    let lateResponse,downloadSignal;
    globalThis.fetch=async(_,options)=>{downloadSignal=options.signal;return new Promise(resolve=>{lateResponse=resolve;});};
    const downloadAbort=new AbortController();let downloadSettled=false;
    const cancelledDownload=runAsr(pcm,{signal:downloadAbort.signal}).catch(error=>{downloadSettled=true;return error;});
    downloadAbort.abort();await Promise.resolve();assert.equal(downloadSettled,true);assert.equal(downloadSignal.aborted,true);assert.equal((await cancelledDownload).name,'AbortError');
    lateResponse(new Response(new Uint8Array(ASSET_MANIFEST.files[0].parts[0].bytes)));
    await new Promise(resolve=>setTimeout(resolve,5));assert.equal(workers.length,2);assert.equal(getResourceStatus().verifiedBytes,0);
  }finally{clearAsrResources();globalThis.fetch=oldFetch;globalThis.Worker=oldWorker;globalThis.location=oldLocation;}
});


test('verified WASM locator adapter rejects foreign module/locator addresses before creating source',()=>{
  const wasmURL=new URL(ASSET_MANIFEST.files.find(f=>f.key==='runtime/ort-wasm-simd-threaded.jsep.wasm').parts[0].url,origin).href;
  const local='blob:https://local.invalid/verified-module';
  assert.match(createVerifiedWasmAdapterSource(local,wasmURL,origin),/VERIFIED_WASM_BINARY_REQUIRED/);
  for(const [module,url] of [['https://local.invalid/unchecked.mjs',wasmURL],['blob:https://other.invalid/module',wasmURL],[local,'https://other.invalid/runtime.wasm'],[local,wasmURL+'?altered=1']])assert.throws(()=>createVerifiedWasmAdapterSource(module,url,origin),e=>e.code==='RUNTIME_LOCATOR');
});

test('exact pinned ORT + JSEP locator control retains verified binary, makes zero fetches, and Worker releases owned URLs',async()=>{
  // A child enables VM modules without requiring a flag for the repository's test command.
  // This is JavaScript-only: browser APIs, private files, model inference and WASM execution
  // are absent. The exact WASM factory is stopped immediately at instantiate().
  const fixture=String.raw`
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as resources from ${JSON.stringify(new URL('../../public/subtitle-workbench/resources.js',import.meta.url).href)};
const {ASSET_MANIFEST,createVerifiedWasmAdapterSource}=resources;
const root=${JSON.stringify(new URL('../../public/',import.meta.url).href)};
const base='https://program-fixture.invalid/subtitle-workbench/asr-worker.js';
const moduleURL='blob:https://program-fixture.invalid/verified-jsep';
const wasmFile=ASSET_MANIFEST.files.find(f=>f.key==='runtime/ort-wasm-simd-threaded.jsep.wasm');
const wasmURL=new URL(wasmFile.parts[0].url,base).href;
const jsepSource=await readFile(new URL('.'+ASSET_MANIFEST.files.find(f=>f.key==='runtime/ort-wasm-simd-threaded.jsep.mjs').parts[0].url,root),'utf8');
const bundle=await readFile(new URL('.'+ASSET_MANIFEST.files.find(f=>f.key==='runtime/transformers.min.js').parts[0].url,root),'utf8');
const binary=new Uint8Array(wasmFile.bytes);let fetches=0,instantiations=0,receivedBinary,forwarded;
const trailing=[];process.on('unhandledRejection',error=>{trailing.push(String(error.message));if(!String(error.message).includes('FIXTURE_STOP_BEFORE_WASM_EXECUTION'))console.error(error);});
const context=vm.createContext({URL,Uint8Array,TextDecoder,TextEncoder,SharedArrayBuffer,performance,setTimeout,clearTimeout,
  console:{log(){},error(){}},WorkerGlobalScope:class{},self:{name:'local-subtitle-tiny-en',location:{href:base}},
  fetch(){fetches++;throw Error('NETWORK_FORBIDDEN');},
  WebAssembly:{Memory:class{constructor(){this.buffer=new ArrayBuffer(65536);}},RuntimeError:WebAssembly.RuntimeError,
  instantiate(bytes){instantiations++;receivedBinary=bytes;throw Error('FIXTURE_STOP_BEFORE_WASM_EXECUTION');},
  instantiateStreaming(){throw Error('STREAMING_FORBIDDEN_WHEN_VERIFIED_BYTES_EXIST');}}});
const jsep=new vm.SourceTextModule(jsepSource,{context,initializeImportMeta(meta){meta.url=moduleURL;}});
await jsep.link(()=>{throw Error('Unexpected module import');});await jsep.evaluate();
const adapterSource=createVerifiedWasmAdapterSource(moduleURL,wasmURL,base);
const adapter=new vm.SourceTextModule(adapterSource,{context});
await adapter.link(specifier=>{assert.equal(specifier,moduleURL);return jsep;});await adapter.evaluate();
assert.throws(()=>adapter.namespace.default({numThreads:1}),/VERIFIED_WASM_BINARY_REQUIRED/);
assert.throws(()=>adapter.namespace.default({numThreads:1,wasmBinary:new Uint8Array(4)}),/VERIFIED_WASM_BINARY_REQUIRED/);
assert.equal(instantiations,0);assert.equal(fetches,0);
// Drive the adapter through the exact pinned ORT initializer, preserving its real
// wasmBinary/locateFile branch behavior rather than using a replacement wrapper.
const start=bundle.indexOf('je=async e=>'),end=bundle.indexOf(',Ve=',start);
assert.ok(start>0&&end>start);
const wrapperContext=vm.createContext({Le:false,Oe:false,De:false,ze:null,Ne:()=>true,Re:()=>true,Be:()=>false,Te:()=>undefined,URL,console,Promise,setTimeout,
  Ie:async requested=>{assert.equal(requested,'blob:https://program-fixture.invalid/local-adapter');return[undefined,args=>{forwarded=args;return adapter.namespace.default(args);}];}});
const initialize=vm.runInContext('('+bundle.slice(start+3,end)+')',wrapperContext);
await assert.rejects(initialize({numThreads:1,initTimeout:0,wasmPaths:{mjs:'blob:https://program-fixture.invalid/local-adapter',wasm:wasmURL},wasmBinary:binary}),/FIXTURE_STOP_BEFORE_WASM_EXECUTION/);
assert.equal(forwarded.wasmBinary,binary);assert.equal(forwarded.locateFile,undefined);
assert.equal(instantiations,1);assert.deepEqual(receivedBinary,binary);assert.equal(fetches,0);
// An unexpected filename must never be converted into a fetchable fallback URL.
const guardContext=vm.createContext({Uint8Array});
const probe=new vm.SyntheticModule(['default'],function(){this.setExport('default',args=>args.locateFile('unexpected-resource'));},{context:guardContext});
const guard=new vm.SourceTextModule(adapterSource,{context:guardContext});await guard.link(()=>probe);await guard.evaluate();
assert.throws(()=>guard.namespace.default({wasmBinary:binary}),/UNAPPROVED_RUNTIME_FILE/);
// Exact current Worker program, synthetic pipeline only: all three module URLs
// are owned and revoked on successful completion, load failure and inference failure.
const workerSource=await readFile(new URL('subtitle-workbench/asr-worker.js',root),'utf8');
const outcomes=[];
for(const mode of ['success','load-error','inference-error','integrity-error']){
  const created=new Map(),revoked=[],messages=[],calls=[];const env={backends:{onnx:{wasm:{}}}};
  class OwnedURL extends URL{static createObjectURL(blob){const url='blob:https://program-fixture.invalid/'+created.size;created.set(url,blob);return url;}static revokeObjectURL(url){revoked.push(url);}}
  const workerContext=vm.createContext({Map,Uint8Array,Float32Array,Blob,URL:OwnedURL,performance,setInterval(){return 1;},clearInterval(){},self:{location:{href:base,origin:new URL(base).origin},postMessage(message){messages.push(message);}}});
  const exports={...resources,verifyCompleteResources:async()=>{calls.push('verified');if(mode==='integrity-error')throw new resources.ResourceError('RESOURCE_HASH','Fixed public resource failed.');},createVerifiedModelCache:()=>({modelBase:'/fixed/models/',misses:[]})};
  const dependency=new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context:workerContext});
  const runtime=new vm.SyntheticModule(['env','pipeline'],function(){this.setExport('env',env);this.setExport('pipeline',async()=>{assert.ok(calls.includes('verified'));if(mode==='load-error')throw Error('Synthetic runtime failure');const transcriber=async()=>{if(mode==='inference-error')throw Error('Synthetic inference failure');return{text:'synthetic',chunks:[]};};transcriber.dispose=async()=>calls.push('disposed');return transcriber;});},{context:workerContext});
  await runtime.link(()=>{});await runtime.evaluate();
  const worker=new vm.SourceTextModule(workerSource,{context:workerContext,importModuleDynamically:async url=>{assert.ok(calls.includes('verified'));assert.ok(created.has(url));return runtime;}});
  await worker.link(()=>dependency);await worker.evaluate();
  await workerContext.self.onmessage({data:{type:'run',runId:99,pcm:new Float32Array(160),resources:[['runtime/transformers.min.js',new ArrayBuffer(1)],['runtime/ort-wasm-simd-threaded.jsep.mjs',new ArrayBuffer(1)],['runtime/ort-wasm-simd-threaded.jsep.wasm',binary.buffer]]}});
  assert.deepEqual(revoked,[...created.keys()]);assert.equal(new Set(revoked).size,revoked.length);assert.equal(created.size,mode==='integrity-error'?0:3);
  if(mode!=='integrity-error'){
    const source=await created.get(env.backends.onnx.wasm.wasmPaths.mjs).text();
    assert.equal(source,createVerifiedWasmAdapterSource([...created.keys()][1],wasmURL,base));
    assert.equal(env.backends.onnx.wasm.wasmBinary.byteLength,wasmFile.bytes);
    assert.equal(env.backends.onnx.wasm.wasmPaths.wasm,wasmURL);
  }
  assert.equal(messages.some(message=>message.type==='result'),mode==='success');
  assert.equal(messages.some(message=>message.type==='error'),mode!=='success');
  if(mode==='success'||mode==='inference-error')assert.ok(calls.includes('disposed'));
  outcomes.push({mode,created:created.size,revoked:revoked.length});
}
await new Promise(resolve=>setTimeout(resolve,20));
assert.ok(trailing.every(message=>message.includes('FIXTURE_STOP_BEFORE_WASM_EXECUTION')));
console.log(JSON.stringify({exactPinnedInitializer:true,exactPinnedJsep:true,adapter:true,verifiedBinaryIdentityPreserved:true,fetches,instantiations,wasmExecuted:false,outcomes}));
`;
  const {stdout}=await promisify(execFile)(process.execPath,['--experimental-vm-modules','--input-type=module','-e',fixture],{maxBuffer:1024*1024,timeout:5000});
  const result=JSON.parse(stdout.trim());
  assert.equal(result.exactPinnedInitializer,true);assert.equal(result.verifiedBinaryIdentityPreserved,true);assert.equal(result.fetches,0);assert.equal(result.instantiations,1);assert.equal(result.wasmExecuted,false);assert.equal(result.outcomes.length,4);
});
