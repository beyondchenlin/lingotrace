import manifest from './assets/manifest.js';

const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const ASSET_MANIFEST = freeze(manifest);
export const ASR_INFO = freeze({
  model:manifest.model,revision:manifest.revision,dtype:manifest.dtype,
  transformersJs:manifest.transformersJs,onnxruntimeWeb:manifest.onnxruntimeWeb,
  device:'wasm',wasmThreads:1,sampleRate:16000,
  modelBytes:manifest.modelBytes,runtimeBytes:manifest.runtimeBytes,totalBytes:manifest.totalBytes,
});
export class ResourceError extends Error {
  constructor(code,message,file) { super(message); this.name='ResourceError'; this.code=code; this.file=file; this.recoverable=true; }
}
export const abortError = () => new DOMException('Local transcription cancelled.','AbortError');
export function checkLive(signal,isCurrent=()=>true) { if (signal?.aborted || !isCurrent()) throw abortError(); }
export async function sha256(bytes,cryptoImpl=globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new ResourceError('CRYPTO_UNAVAILABLE','This browser cannot verify local model resources.');
  return [...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}

/** Validate the complete plan before the first network request; never repair or reorder it. */
export function validateResourceManifest(plan=ASSET_MANIFEST,baseURL=globalThis.location?.href) {
  const base = new URL(baseURL);
  if (!['https:','http:'].includes(base.protocol)) throw new ResourceError('ORIGIN','Resources require a same-origin HTTP(S) page.');
  if (!plan || typeof plan.prefix!=='string' || !plan.prefix.startsWith('/subtitle-workbench/assets/') || !Array.isArray(plan.files) || !plan.files.length) throw new ResourceError('MANIFEST','Invalid public resource manifest.');
  const keys = new Set(), urls = new Set(); let sum=0;
  for (const file of plan.files) {
    if (typeof file.key!=='string' || keys.has(file.key) || !['model','runtime'].includes(file.kind) || !Number.isSafeInteger(file.bytes) || file.bytes<1 || !/^[a-f0-9]{64}$/.test(file.sha256) || !Array.isArray(file.parts) || !file.parts.length) throw new ResourceError('MANIFEST','Invalid public resource entry.');
    keys.add(file.key); let offset=0;
    for (const [index,part] of file.parts.entries()) {
      let url; try { url=new URL(part.url,base); } catch { throw new ResourceError('MANIFEST','Invalid public resource address.',file.key); }
      if (part.index!==index || part.offset!==offset || !Number.isSafeInteger(part.bytes) || part.bytes<1 || part.bytes>=25*1024*1024 || (file.parts.length>1 && part.bytes>8*1024*1024) || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new ResourceError('MANIFEST_ORDER','Resource part size, order, or offset is invalid.',file.key);
      if (typeof part.url!=='string' || !part.url.startsWith(plan.prefix+'/') || url.origin!==base.origin || url.username || url.password || url.search || url.hash || url.pathname!==part.url || urls.has(url.href)) throw new ResourceError('ORIGIN','Only fixed same-origin public resource addresses are allowed.',file.key);
      urls.add(url.href); offset+=part.bytes;
    }
    if (offset!==file.bytes) throw new ResourceError('MANIFEST_SIZE','Resource parts do not match the complete size.',file.key);
    sum+=file.bytes;
  }
  if (sum!==plan.totalBytes) throw new ResourceError('MANIFEST_SIZE','Public resource total is invalid.');
  return plan;
}

async function assertDigest(bytes,spec,{signal,isCurrent,cryptoImpl}) {
  checkLive(signal,isCurrent);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength!==spec.bytes) throw new ResourceError('RESOURCE_SIZE','The public resource has an unexpected size. Clear resources and retry.',spec.key ?? spec.url);
  const digest=await sha256(bytes,cryptoImpl); checkLive(signal,isCurrent);
  if (digest!==spec.sha256) throw new ResourceError('RESOURCE_HASH','The public resource failed SHA-256 verification. Clear resources and retry.',spec.key ?? spec.url);
}

async function fetchPart(part,{baseURL,fetchImpl,signal,isCurrent,onBytes}) {
  checkLive(signal,isCurrent);
  const expected=new URL(part.url,baseURL).href;
  let response;
  try { response=await fetchImpl(expected,{method:'GET',mode:'same-origin',credentials:'omit',redirect:'error',cache:'default',referrerPolicy:'no-referrer',signal}); }
  catch { checkLive(signal,isCurrent); throw new ResourceError('RESOURCE_NETWORK','A public model resource could not be downloaded. Check the connection and retry.',part.url); }
  checkLive(signal,isCurrent);
  if (!response.ok || response.status!==200) throw new ResourceError('RESOURCE_MISSING','A required public model resource is unavailable. Retry when it is available.',part.url);
  if (response.redirected || (response.url && response.url!==expected) || response.type==='opaqueredirect') throw new ResourceError('RESOURCE_REDIRECT','Redirected model resources are not permitted.',part.url);
  const buffer=new Uint8Array(part.bytes); let loaded=0;
  if (response.body) {
    const reader=response.body.getReader();
    try {
      while (true) {
        const next=await reader.read(); checkLive(signal,isCurrent);
        if (next.done) break;
        if (!(next.value instanceof Uint8Array) || loaded+next.value.byteLength>part.bytes) throw new ResourceError('RESOURCE_SIZE','A public resource exceeded its fixed size.',part.url);
        buffer.set(next.value,loaded); loaded+=next.value.byteLength; onBytes(next.value.byteLength);
      }
    } catch (error) {
      await reader.cancel().catch(()=>{}); checkLive(signal,isCurrent);
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('RESOURCE_NETWORK','A public model download was interrupted. Retry the resource download.',part.url);
    } finally { reader.releaseLock(); }
  } else {
    const bytes=new Uint8Array(await response.arrayBuffer()); checkLive(signal,isCurrent);
    if (bytes.byteLength!==part.bytes) throw new ResourceError('RESOURCE_SIZE','A public resource has the wrong size.',part.url);
    buffer.set(bytes); loaded=bytes.byteLength; onBytes(loaded);
  }
  if (loaded!==part.bytes) throw new ResourceError('RESOURCE_SIZE','A public resource download is incomplete.',part.url);
  return buffer;
}

/** Asset-only RAM cache. Imported drafts/media never enter this map or any request. */
export async function loadPublicResources({plan=ASSET_MANIFEST,baseURL=globalThis.location?.href,fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,signal,isCurrent=()=>true,cache=new Map(),onProgress=()=>{}}={}) {
  validateResourceManifest(plan,baseURL); checkLive(signal,isCurrent);
  const started=performance.now(),resources=new Map(); let loadedBytes=0,downloadBytes=0,verifySeconds=0,downloadSeconds=0,cachedFiles=0;
  const progress=(stage,file,extra={})=>onProgress({stage,file,loadedBytes,totalBytes:plan.totalBytes,downloadBytes,elapsedSeconds:(performance.now()-started)/1000,indeterminate:stage!=='download',...extra});
  for (const file of plan.files) {
    checkLive(signal,isCurrent); let bytes=cache.get(file.key);
    if (bytes) {
      progress('verify',file.key,{cacheHit:true}); const t=performance.now();
      try { await assertDigest(bytes,file,{signal,isCurrent,cryptoImpl}); }
      catch(error) { if ((error.code==='RESOURCE_HASH' || error.code==='RESOURCE_SIZE') && cache.get(file.key)===bytes) cache.delete(file.key); throw error; }
      verifySeconds+=(performance.now()-t)/1000; cachedFiles++; loadedBytes+=file.bytes;
    } else {
      bytes=new Uint8Array(file.bytes);
      for (const part of file.parts) {
        progress('download',part.url,{cacheHit:false}); const t=performance.now();
        const piece=await fetchPart(part,{baseURL,fetchImpl,signal,isCurrent,onBytes:n=>{loadedBytes+=n;downloadBytes+=n;progress('download',part.url,{cacheHit:false});}});
        downloadSeconds+=(performance.now()-t)/1000;
        progress('verify',part.url,{cacheHit:false}); const v=performance.now();
        await assertDigest(piece,part,{signal,isCurrent,cryptoImpl}); verifySeconds+=(performance.now()-v)/1000;
        bytes.set(piece,part.offset);
      }
      // Full-file hashing is a separate mandatory gate even if all four part hashes pass.
      progress('verify',file.key,{cacheHit:false}); const v=performance.now();
      await assertDigest(bytes,file,{signal,isCurrent,cryptoImpl}); verifySeconds+=(performance.now()-v)/1000;
      checkLive(signal,isCurrent); cache.set(file.key,bytes);
    }
    resources.set(file.key,bytes);
  }
  checkLive(signal,isCurrent);
  return {resources,downloadSeconds,verifySeconds,downloadBytes,cachedFiles,cachedAssets:cachedFiles===plan.files.length};
}

/** Worker-side second gate, before importing runtime or constructing a pipeline. */
export async function verifyCompleteResources(resources,{plan=ASSET_MANIFEST,signal,isCurrent,cryptoImpl=globalThis.crypto}={}) {
  if (!(resources instanceof Map) || resources.size!==plan.files.length) throw new ResourceError('RESOURCE_MISSING','The verified public resource set is incomplete.');
  for (const file of plan.files) {
    const bytes=resources.get(file.key);
    await assertDigest(bytes,file,{signal,isCurrent,cryptoImpl});
    for (const part of file.parts) await assertDigest(bytes.subarray(part.offset,part.offset+part.bytes),part,{signal,isCurrent,cryptoImpl});
  }
}

/** Return a Response even on misses. Transformers tryCache swallows match exceptions;
 * an errored body fails later at response consumption without any local/remote fetch.
 * The pre-pipeline verification remains the primary integrity gate. */
export function createVerifiedModelCache(resources,{plan=ASSET_MANIFEST,baseURL=globalThis.location?.href}={}) {
  const byURL=new Map();
  const modelBase=`${plan.prefix}/models/`;
  for (const file of plan.files.filter(f=>f.kind==='model')) byURL.set(new URL(`${modelBase}${plan.model}/${file.file}`,baseURL).href,{file,bytes:resources.get(file.key)});
  const misses=[];
  const failedResponse=key=>new Response(new ReadableStream({start(controller){controller.error(new ResourceError('RESOURCE_UNAPPROVED','The runtime requested an unavailable public resource.',key));}}));
  return {
    modelBase,misses,
    async match(request) {
      let url; try { url=new URL(typeof request==='string'?request:request.url,baseURL); } catch { misses.push('invalid-request'); return failedResponse('invalid-request'); }
      const entry=byURL.get(url.href);
      if (!entry?.bytes || entry.bytes.byteLength!==entry.file.bytes || url.search || url.hash) { misses.push('unapproved-model-resource'); return failedResponse('unapproved-model-resource'); }
      return new Response(entry.bytes,{status:200,headers:{'Content-Type':entry.file.file.endsWith('.json')?'application/json':'application/octet-stream','Content-Length':String(entry.file.bytes)}});
    },
    async put() { throw new ResourceError('RESOURCE_CACHE_WRITE','The verified model cache is read-only.'); },
  };
}

/** The pinned ORT wrapper drops locateFile when wasmBinary is present, while JSEP
 * resolves a relative WASM URL even for supplied bytes. Wrap its verified module
 * without changing library bytes, and keep the verified binary as the only input.
 * The fixed locator is never a permission to fetch: missing binary is rejected. */
export function createVerifiedWasmAdapterSource(jsepModuleURL,wasmURL,baseURL=globalThis.location?.href) {
  const base=new URL(baseURL),moduleURL=new URL(jsepModuleURL),binaryURL=new URL(wasmURL,base);
  const wasm=ASSET_MANIFEST.files.find(file=>file.key==='runtime/ort-wasm-simd-threaded.jsep.wasm');
  if(moduleURL.protocol!=='blob:' || moduleURL.origin!==base.origin || moduleURL.search || moduleURL.hash || binaryURL.href!==new URL(wasm.parts[0].url,base).href) throw new ResourceError('RUNTIME_LOCATOR','The verified runtime locator is invalid.');
  return `import initialize from ${JSON.stringify(moduleURL.href)};
export default function initializeVerifiedRuntime(args) {
  if (!(args?.wasmBinary instanceof Uint8Array) || args.wasmBinary.byteLength !== ${wasm.bytes}) throw new Error('VERIFIED_WASM_BINARY_REQUIRED');
  return initialize({...args, locateFile(filename) {
    if (filename !== 'ort-wasm-simd-threaded.jsep.wasm') throw new Error('UNAPPROVED_RUNTIME_FILE');
    return ${JSON.stringify(binaryURL.href)};
  }});
}\n`;
}
