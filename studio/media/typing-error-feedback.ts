import {SubmissionAudio} from './submission-audio.ts';

export const TYPING_ERROR_PREFERENCE_KEY='lingotrace-typing-error-feedback-v1';
export interface TypingErrorPreferences {sound:boolean;motion:boolean}
export const DEFAULT_TYPING_ERROR_PREFERENCES:Readonly<TypingErrorPreferences>=Object.freeze({sound:true,motion:true});
export function parseTypingErrorPreferences(raw:string|null):TypingErrorPreferences {
 if(raw===null)return {...DEFAULT_TYPING_ERROR_PREFERENCES};
 try{const value=JSON.parse(raw);if(value&&typeof value.sound==='boolean'&&typeof value.motion==='boolean')return {sound:value.sound,motion:value.motion}}catch{}
 // Corrupt/unreadable explicit settings never turn a previously disabled cue on.
 return {sound:false,motion:false};
}
export interface TypingErrorFeedbackOptions {
 audio?:SubmissionAudio; now?:()=>number; vibrate?:(duration:number)=>boolean;
 shake:(started:number|undefined)=>void;
}
/** One local-only graph, shared F03 implementation, never attached to a recorder. */
export class TypingErrorFeedback {
 readonly audio:SubmissionAudio;
 private readonly now:()=>number;
 private readonly vibrate:((duration:number)=>boolean)|undefined;
 private readonly shake:(started:number|undefined)=>void;
 private preferences:TypingErrorPreferences={...DEFAULT_TYPING_ERROR_PREFERENCES};
 private activationFailed=false;private readonly stopWatchingAudio:()=>void;
 private muted=false;private reduced=false;private recording=false;private disposed=false;
 private lastAt=-Infinity;private priorityUntil=-Infinity;private hapticActive=false;
 constructor(options:TypingErrorFeedbackOptions){
  this.audio=options.audio??new SubmissionAudio({volume:.28});
  this.now=options.now??(()=>performance.now());this.vibrate=options.vibrate;this.shake=options.shake;
  this.stopWatchingAudio=this.audio.subscribe(()=>{if(this.audio.getSnapshot().error)this.activationFailed=true});
 }
 configure(preferences:TypingErrorPreferences,options:{muted:boolean;reduced:boolean;recording:boolean}){
  this.preferences={...preferences};this.muted=options.muted;this.reduced=options.reduced;this.recording=options.recording;
  this.audio.setMonitorMuted(this.muted);
  if(!preferences.sound)this.audio.disable();
  if(!preferences.motion||this.reduced||this.recording||this.muted)this.cancelMotion();
 }
 /** Call synchronously from a trusted user gesture. Never play/queue the triggering edit after resume. */
 prepare(trusted:boolean){
  if(this.disposed||!trusted||!this.preferences.sound||this.muted||this.activationFailed)return;
  const state=this.audio.getSnapshot();if(state.enabled||state.enabling)return;
  // New genuine interaction may recover only a background/system interruption.
  // Rejected/failed activation never becomes a per-keystroke automatic retry.
  if(state.disableReason&&!['user','hidden','pagehide','interrupted'].includes(state.disableReason))return;
  void this.audio.enable().catch(()=>{});
 }
 get failed(){return this.activationFailed}
 retryFromGesture(trusted:boolean){if(!trusted)return;this.activationFailed=false;this.audio.disable();this.prepare(true)}
 pulse(options:{sound?:boolean;checked?:boolean}={}):boolean{
  const now=this.now();
  if(this.disposed||!Number.isFinite(now)||now<this.priorityUntil||(!options.checked&&now-this.lastAt<360))return false;
  this.lastAt=now;
  if(options.sound!==false&&this.preferences.sound&&!this.muted)this.audio.playInputError();
  if(this.preferences.motion&&!this.reduced&&!this.recording){
   this.shake(now);
   if(!this.muted&&this.vibrate){try{this.hapticActive=this.vibrate(18)}catch{this.hapticActive=false}}
  }
  return true;
 }
 /** Exact submitted F03 cue owns this moment, including first completion. */
 submission(errors:number,firstCompletion:boolean,submissionSoundEnabled:boolean){
  this.cancel();
  if(errors>0&&!firstCompletion){this.priorityUntil=-Infinity;this.pulse({sound:!submissionSoundEnabled,checked:true})}
  this.priorityUntil=this.now()+500;
 }
 cancel(){this.audio.cancelInputError();this.cancelMotion()}
 private cancelMotion(){this.shake(undefined);if(this.hapticActive&&this.vibrate){try{this.vibrate(0)}catch{}}this.hapticActive=false}
 suspend(){this.cancel();this.audio.disable('hidden')}
 dispose(){if(this.disposed)return;this.cancel();this.disposed=true;this.stopWatchingAudio();this.audio.dispose()}
}
