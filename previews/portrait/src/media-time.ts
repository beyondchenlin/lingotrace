/** Presentation-only media controls. No training events, storage, or autoplay. */
export interface TimingMedia extends EventTarget {readonly readyState:number;readonly duration:number;currentTime:number}
export interface TimingControls {duration:{textContent:string|null};elapsed:{textContent:string|null};seek:{disabled:boolean;max:string;value:string}}
export function formatMediaTime(seconds:number):string{return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`}
export function bindMediaTiming(media:TimingMedia,controls:TimingControls){
 const knownDuration=()=>media.readyState>0&&Number.isFinite(media.duration)&&media.duration>0?media.duration:null;
 function sync(){const duration=knownDuration(),time=Number.isFinite(media.currentTime)&&media.currentTime>=0?media.currentTime:0;
  controls.duration.textContent=duration===null?'--:--':formatMediaTime(duration);
  controls.elapsed.textContent=formatMediaTime(time);controls.seek.disabled=duration===null;
  controls.seek.max=String(duration??1);controls.seek.value=String(duration===null?0:Math.min(duration,time));
 }
 function seek(seconds:number){const duration=knownDuration();if(duration===null||!Number.isFinite(seconds)){sync();return false}media.currentTime=Math.max(0,Math.min(duration,seconds));sync();return true}
 const events=['loadedmetadata','durationchange','emptied','timeupdate'];for(const event of events)media.addEventListener(event,sync);
 // Metadata may already be available before this module is evaluated.
 sync();
 return{sync,seek,dispose(){for(const event of events)media.removeEventListener(event,sync)}};
}
