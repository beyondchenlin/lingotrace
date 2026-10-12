import {liveLetterFeedback,MAX_FEEDBACK_TEXT_UTF16} from './live-letter-feedback';

export interface TypingErrorEdit {
 before:string; after:string; reference:string|undefined;
 trusted:boolean; kind:'input'|'compositionend'; inputType:string|null;
 composing?:boolean; pasted?:boolean;
}
/** A transient cue for a newly inserted wrong native span, never a judgment or input event. */
export function hasNewTypingError(edit:TypingErrorEdit):boolean {
 const {before,after,reference}=edit;
 if(!edit.trusted||edit.composing||edit.pasted||reference===undefined||before===after||
   before.length>MAX_FEEDBACK_TEXT_UTF16||after.length>MAX_FEEDBACK_TEXT_UTF16||
   (edit.kind==='input'&&edit.inputType!=='insertText'))return false;
 let start=0,endBefore=before.length,endAfter=after.length;
 while(start<endBefore&&start<endAfter&&before[start]===after[start])start++;
 while(endBefore>start&&endAfter>start&&before[endBefore-1]===after[endAfter-1]){endBefore--;endAfter--}
 // A deletion/re-alignment or unchanged old mistake is not a new wrong insertion.
 if(endAfter<=start)return false;
 return liveLetterFeedback(after,reference).some(range=>range.kind==='wrong'&&range.start<endAfter&&range.end>start);
}

export const TYPING_ERROR_INTERVAL_MS=360;
export const TYPING_ERROR_SHAKE_MS=180;
/** At most two small oscillations, applied to wrong letters only. Native geometry stays fixed. */
export function typingErrorShakeOffset(now:number,started:number|undefined,reducedMotion:boolean,recording=false):number {
 if(reducedMotion||recording||started===undefined||!Number.isFinite(started)||!Number.isFinite(now))return 0;
 const elapsed=now-started;
 if(elapsed<0||elapsed>=TYPING_ERROR_SHAKE_MS)return 0;
 const progress=elapsed/TYPING_ERROR_SHAKE_MS;
 return 2*Math.sin(progress*Math.PI*4)*(1-progress);
}
