import{getCurrentResult,getDraft,type Attempt,type TrainingSnapshot}from'./training';
export interface DraftFeedback{status:'unjudged'|'composing'|'matched'|'correction';attempt:Attempt|null;message:string}
/** Display a judgment only for the exact current cue, committed version and visible text. */
export function getDraftFeedback(snapshot:TrainingSnapshot|null,visibleDraft:string,composing=false):DraftFeedback{
 const inComposition=composing||!!snapshot?.frozenReasons.includes('composition');
 if(inComposition)return{status:'composing',attempt:null,message:'输入法组合中 · 尚未判定'};
 const draft=snapshot?getDraft(snapshot):null,result=snapshot?getCurrentResult(snapshot):null;
 const valid=!!snapshot&&!!draft&&!!result&&result.sessionId===snapshot.sessionId&&result.roundId===snapshot.roundId&&result.materialVersion===snapshot.material.version&&result.cueId===snapshot.material.cues[snapshot.cueIndex].id&&result.inputVersion===draft.version&&result.answer===draft.text&&visibleDraft===draft.text;
 if(valid){const a=result!;return{status:a.errors===0?'matched':'correction',attempt:a,message:`${a.errors===0?'本句已匹配':'修改后再试'} · ${a.errors} 处编辑错误 · ${a.conditions.exposure==='first'?'首次':'重练'}${a.conditions.hinted?' · 提示':''}${a.conditions.revealed?' · 已看字幕':''}${a.conditions.pasted?' · 含粘贴':''}`}}
 const hadAttempt=!!snapshot?.attempts.some(a=>a.cueId===snapshot.material.cues[snapshot.cueIndex].id);
 return{status:'unjudged',attempt:null,message:hadAttempt?'草稿已修改 · 尚未判定，请确认检查':visibleDraft.trim()?'尚未判定 · 输入完成后确认':'LISTEN · TYPE · CONFIRM'};
}
