import {ASSET_MANIFEST,ASR_INFO,ResourceError,abortError,checkLive,loadPublicResources} from './resources.js';
export {ASR_INFO};
const sessionResources=new Map(); let serial=0,active=null;
export function getResourceStatus() {
  let verifiedBytes=0,verifiedFiles=0;
  for (const file of ASSET_MANIFEST.files) if (sessionResources.get(file.key)?.byteLength===file.bytes) { verifiedBytes+=file.bytes; verifiedFiles++; }
  return {mode:'session-memory',verifiedFiles,verifiedBytes,totalFiles:ASSET_MANIFEST.files.length,totalBytes:ASR_INFO.totalBytes,complete:verifiedFiles===ASSET_MANIFEST.files.length,persistent:false};
}
/** Clears only this page's public asset RAM. The browser may retain its HTTP cache. */
export function clearAsrResources() { active?.cancel(); sessionResources.clear(); return getResourceStatus(); }

/** One active request. PCM is copied before transfer, never retained by the asset cache. */
export function runAsr(pcm,{onProgress=()=>{},signal}={}) {
  if (!(pcm instanceof Float32Array) || !pcm.length || pcm.length>16000*60 || pcm.some(value=>!Number.isFinite(value))) return Promise.reject(new ResourceError('PCM_INVALID','Choose decodable audio of at most 60 seconds.'));
  if (signal?.aborted) return Promise.reject(abortError());
  active?.cancel(); const id=++serial,controller=new AbortController(); let worker=null,settled=false;
  return new Promise((resolve,reject)=>{
    const current=()=>active?.id===id && !settled;
    const cleanup=()=>{signal?.removeEventListener('abort',cancel); worker?.terminate(); worker=null; if(active?.id===id) active=null;};
    const finish=(error,value)=>{ if(settled)return; settled=true; cleanup(); if(error)reject(error); else resolve(value); };
    const cancel=()=>{controller.abort(); finish(abortError());};
    active={id,cancel}; signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted) { cancel(); return; }
    const report=progress=>{if(current())onProgress(progress);};
    (async()=>{
      const prepared=await loadPublicResources({signal:controller.signal,isCurrent:current,cache:sessionResources,onProgress:report});
      checkLive(controller.signal,current);
      report({stage:'loading',indeterminate:true,elapsedSeconds:0,loadedBytes:ASR_INFO.totalBytes,totalBytes:ASR_INFO.totalBytes,cachedAssets:prepared.cachedAssets});
      try { worker=new Worker(new URL('./asr-worker.js',import.meta.url),{type:'module',name:'local-subtitle-tiny-en'}); }
      catch { throw new ResourceError('WORKER_UNAVAILABLE','This browser could not start local transcription. Retry or import subtitles.'); }
      worker.onmessage=event=>{
        const message=event.data;
        if(!current() || message?.runId!==id)return;
        if(message.type==='progress')report(message.progress);
        else if(message.type==='result')finish(null,{...message.result,downloadSeconds:prepared.downloadSeconds,verifySeconds:prepared.verifySeconds+(message.result.workerVerifySeconds??0),cachedAssets:prepared.cachedAssets});
        else if(message.type==='error') { const error=new ResourceError(message.code,message.message,message.file); error.stage=message.stage; finish(error); }
      };
      worker.onerror=event=>{event.preventDefault();finish(new ResourceError('WORKER_ERROR','The local transcription worker stopped. Resources remain available for retry.'));};
      worker.onmessageerror=()=>finish(new ResourceError('WORKER_MESSAGE','The local worker could not return its result. Retry or import subtitles.'));
      // Keep only approved public assets in page-session RAM; a fresh worker gets owned copies.
      const entries=[...prepared.resources].map(([key,bytes])=>[key,bytes.slice().buffer]);
      const ownedPCM=pcm.slice();
      checkLive(controller.signal,current);
      worker.postMessage({type:'run',runId:id,pcm:ownedPCM,resources:entries},[ownedPCM.buffer,...entries.map(([,buffer])=>buffer)]);
    })().catch(error=>finish(error instanceof ResourceError || error?.name==='AbortError'?error:new ResourceError('LOCAL_RESOURCES','Local resource preparation failed. Clear resources, then retry.')));
  });
}
