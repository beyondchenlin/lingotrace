import {ASSET_MANIFEST,ASR_INFO,ResourceError,verifyCompleteResources,createVerifiedModelCache,createVerifiedWasmAdapterSource} from './resources.js';

let started=false;
self.onmessage=async event=>{
  const message=event.data;
  if(message?.type!=='run' || started)return;
  started=true;
  const {runId,pcm}=message,workerStarted=performance.now(); let stage='verify',transcriber=null; const urls=[];
  const progress=()=>self.postMessage({type:'progress',runId,progress:{stage,indeterminate:true,elapsedSeconds:(performance.now()-workerStarted)/1000,loadedBytes:ASR_INFO.totalBytes,totalBytes:ASR_INFO.totalBytes}});
  // Timers keep elapsed time honest where the inference backend yields; no invented ETA/percent.
  const heartbeat=setInterval(progress,1000);
  try {
    if(!(pcm instanceof Float32Array) || !pcm.length || pcm.length>960000 || pcm.some(n=>!Number.isFinite(n)))throw new ResourceError('PCM_INVALID','The local worker received invalid audio.');
    const resources=new Map(message.resources.map(([key,buffer])=>[key,new Uint8Array(buffer)]));
    progress(); await verifyCompleteResources(resources);
    const verifiedAt=performance.now();
    const makeOwnedModule=bytes=>{const url=URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));urls.push(url);return url;};
    const makeModule=key=>makeOwnedModule(resources.get(key));
    stage='loading'; progress();
    // Modules execute only the already verified bytes. Blob URLs are local to this origin.
    // No dynamic import can follow a network redirect after the pre-download integrity gate.
    const {pipeline,env}=await import(makeModule('runtime/transformers.min.js'));
    const cache=createVerifiedModelCache(resources);
    env.allowRemoteModels=false; env.allowLocalModels=true;
    env.localModelPath=cache.modelBase;
    env.useFS=false; env.useFSCache=false; env.useBrowserCache=false;
    env.useCustomCache=true; env.customCache=cache;
    // Defensive remote addressing is same-origin as well; remote loading remains disabled.
    env.remoteHost=self.location.origin; env.remotePathTemplate=`${ASSET_MANIFEST.prefix}/disabled-remote/`;
    env.backends.onnx.wasm.numThreads=1;
    env.backends.onnx.wasm.proxy=false;
    const wasmURL=new URL(ASSET_MANIFEST.files.find(f=>f.key==='runtime/ort-wasm-simd-threaded.jsep.wasm').parts[0].url,self.location.href).href;
    const jsepURL=makeModule('runtime/ort-wasm-simd-threaded.jsep.mjs');
    // Preserve verified wasmBinary and supply JSEP's required locator via a small
    // local adapter. ORT 1.22 drops its own locateFile whenever wasmBinary exists.
    env.backends.onnx.wasm.wasmPaths={
      mjs:makeOwnedModule(createVerifiedWasmAdapterSource(jsepURL,wasmURL,self.location.href)),
      wasm:wasmURL,
    };
    env.backends.onnx.wasm.wasmBinary=resources.get('runtime/ort-wasm-simd-threaded.jsep.wasm');
    transcriber=await pipeline('automatic-speech-recognition',ASR_INFO.model,{
      revision:ASR_INFO.revision,device:'wasm',dtype:'q8',local_files_only:true,
    });
    if(cache.misses.length)throw new ResourceError('RESOURCE_UNAPPROVED','The local model requested a resource outside the fixed manifest.');
    const loadedAt=performance.now();stage='inference';progress();
    const options={return_timestamps:'word',chunk_length_s:30,stride_length_s:5};
    const output=await transcriber(pcm,options);
    const endedAt=performance.now();
    if(cache.misses.length)throw new ResourceError('RESOURCE_UNAPPROVED','The local model requested a resource outside the fixed manifest.');
    self.postMessage({type:'result',runId,result:{
      ...ASR_INFO,sampleRate:16000,audioSamples:pcm.length,options,output,
      workerVerifySeconds:(verifiedAt-workerStarted)/1000,
      modelLoadSeconds:(loadedAt-verifiedAt)/1000,inferenceSeconds:(endedAt-loadedAt)/1000,
      workerTotalSeconds:(endedAt-workerStarted)/1000,
    }});
  }catch(error){
    // Only fixed public resource IDs and bounded categories cross this error boundary.
    // Do not attach PCM, filenames, transcription content, browser fingerprints or stack traces.
    const known=error instanceof ResourceError;
    const allocation=!known && /memory|alloc|out of bounds/i.test(String(error?.message??''));
    self.postMessage({type:'error',runId,stage,code:known?error.code:allocation?'MEMORY_LIMIT':stage==='loading'?'MODEL_LOAD_FAILED':'INFERENCE_FAILED',
      message:known?error.message:allocation?'The browser ran out of local transcription memory. Close other tabs or choose a shorter clip.':stage==='loading'?'The verified local model could not start. Retry or import an existing subtitle file.':'Local transcription failed. Retry or import an existing subtitle file.',
      file:known && typeof error.file==='string'?error.file:undefined,recoverable:true});
  }finally{
    clearInterval(heartbeat); for(const url of urls)URL.revokeObjectURL(url);
    if(transcriber)await transcriber.dispose().catch(()=>{});
  }
};
