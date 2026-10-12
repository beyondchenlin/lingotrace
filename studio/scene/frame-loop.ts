/** One automatic recovery attempt per failure run; persistent failures wait for a click. */
export function startSceneFrameLoop(draw:(time:number)=>void,options:{
 request:(callback:FrameRequestCallback)=>number;cancel:(id:number)=>void;
 recover:()=>void;onError:(error:unknown,terminal:boolean)=>void;onRecovered:()=>void;
}){
 let frame:number|null=null,disposed=false,failures=0,failed=false,recovering=false;
 const schedule=()=>{if(!disposed&&!failed&&frame===null)frame=options.request(tick)};
 const tick=(time:number)=>{
  frame=null;if(disposed||failed)return;
  try{draw(time);if(recovering){failures=0;recovering=false;options.onRecovered()}}
  catch(error){
   recovering=true;failures++;failed=failures>=2;
   // Notify first, so recording can set its logical cutoff before pixels reset.
   options.onError(error,failed);
   try{options.recover()}catch(recoveryError){failed=true;options.onError(recoveryError,true)}
  }
  schedule();
 };
 schedule();
 return{
  retry(){if(disposed)return;failed=false;failures=0;recovering=true;try{options.recover();schedule()}catch(error){failed=true;options.onError(error,true)}},
  dispose(){disposed=true;if(frame!==null)options.cancel(frame);frame=null},
 };
}
/** Resets every save/clip/transform, including nested state left by a thrown painter. */
export function resetSceneContext(canvas:HTMLCanvasElement){canvas.width=canvas.width}

/** Small allowlisted failure code only; never expose a message, stack or user content. */
export type SceneRenderPhase='context'|'snapshot'|'native-input'|'media-state'|'projection'|'scene-paint'|'post-paint'|'context-reset';
const renderPhases:readonly string[]=['context','snapshot','native-input','media-state','projection','scene-paint','post-paint','context-reset'];
const renderErrorNames:readonly string[]=['Error','TypeError','RangeError','IndexSizeError','InvalidStateError','NotSupportedError','SecurityError','SyntaxError','OperationError','QuotaExceededError','UnknownError'];
export function sceneRenderFailureCode(error:unknown,phase:unknown):string{
 let name='Error';
 try{const candidate=error&&typeof error==='object'?(error as {name?:unknown}).name:undefined;if(typeof candidate==='string'&&renderErrorNames.includes(candidate))name=candidate}catch{}
 return `${typeof phase==='string'&&renderPhases.includes(phase)?phase:'unknown'} / ${name}`;
}
