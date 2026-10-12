/** Ephemeral reference-following presentation, never a Training/input/time metric.
 * Native progression admits a point; sentence interpolation supplies its estimate.
 * This module has no engine, storage, observation or event-writing dependencies. */
export interface ListeningCadenceSample {
 readonly monoMs:number;readonly mediaSeconds:number;readonly rate:number;readonly boundary:number;
 readonly active:boolean;readonly visible:boolean;readonly hidden:boolean;readonly playing:boolean;
 readonly waiting:boolean;readonly seeking:boolean;readonly blocked:boolean;readonly reducedMotion:boolean;
 readonly cueId:string|null;readonly referencePresent:boolean;readonly estimatedRate:number|null;
}
export interface ListeningCadenceFrame {
 readonly source:'sentence-reference';readonly quality:'estimated';readonly storage:'ephemeral';
 readonly status:'active'|'waiting'|'paused'|'hidden'|'inactive'|'reduced-motion';
 readonly points:readonly {readonly atMs:number;readonly value:number}[];readonly endMs:number;readonly windowMs:30000;
}
const WINDOW_MS=30000,MIN_STEP_MS=200,MAX_GAP_MS=1500,MEDIA_TOLERANCE_SECONDS=.12;
export class ListeningCadenceProjector {
 private previous:ListeningCadenceSample|null=null;
 private points:{atMs:number;value:number}[]=[];
 private status:ListeningCadenceFrame['status']='waiting';
 private clear(status:ListeningCadenceFrame['status']){this.previous=null;this.points=[];this.status=status}
 private frame():ListeningCadenceFrame{return{source:'sentence-reference',quality:'estimated',storage:'ephemeral',status:this.status,points:this.points.map(p=>({...p})),endMs:this.points.at(-1)?.atMs??0,windowMs:WINDOW_MS}}
 sample(s:ListeningCadenceSample):ListeningCadenceFrame {
  const unavailable:ListeningCadenceFrame['status']|null=!s.active?'inactive':!s.visible||s.hidden?'hidden':s.reducedMotion?'reduced-motion':!s.playing||s.waiting||s.seeking||s.blocked?'paused':!s.referencePresent||!s.cueId||!Number.isFinite(s.monoMs)||s.monoMs<0||!Number.isFinite(s.mediaSeconds)||s.mediaSeconds<0||!Number.isFinite(s.rate)||s.rate<=0||s.estimatedRate===null||!Number.isFinite(s.estimatedRate)||s.estimatedRate<=0?'waiting':null;
  if(unavailable){this.clear(unavailable);return this.frame()}
  const a=this.previous;
  if(!a||a.boundary!==s.boundary||a.cueId!==s.cueId||a.rate!==s.rate){this.clear('waiting');this.previous={...s};return this.frame()}
  const dt=s.monoMs-a.monoMs;
  if(dt>=0&&dt<MIN_STEP_MS)return this.frame();
  this.previous={...s};
  const dm=s.mediaSeconds-a.mediaSeconds;
  if(dt<0||dt>MAX_GAP_MS||dm<=0||Math.abs(dm-a.rate*dt/1000)>MEDIA_TOLERANCE_SECONDS){this.points=[];this.status='waiting';return this.frame()}
  if(this.points.length===0)this.points.push({atMs:a.monoMs,value:a.estimatedRate!});
  this.points.push({atMs:s.monoMs,value:s.estimatedRate!});
  this.points=this.points.filter(p=>p.atMs>=s.monoMs-WINDOW_MS).slice(-152);
  this.status='active';return this.frame();
 }
}
