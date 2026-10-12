import type { InputPulseMetric, InputPulseNode, RenderClock } from '../schema.ts';
import { eligiblePulseEvents, inputWaveSamples, pulseReferenceTime } from '../metrics.ts';
import { empty, footnote, line, text, unavailable, type Paint } from './shared.ts';
export function paintInputPulse(p: Paint, node: InputPulseNode, metric: InputPulseMetric, clock: RenderClock) {
  if (unavailable(p)) { empty(p); return; }
  const now=pulseReferenceTime(metric,clock,node.motion),events=eligiblePulseEvents(metric,now,node.windowMs);
  const left=18,right=p.width-18,baseline=p.height*.58,extent=p.height*.18;
  const staticView=clock.reducedMotion||node.motion==='none',wave=node.visualization==='wave-scan'&&!staticView;
  line(p,[[left,baseline],[right,baseline]],p.colors.track);
  if(wave){
    const points=inputWaveSamples(metric,now,node.windowMs,Math.min(1500,Math.ceil(right-left)*2)).map(([at,value])=>[left+(at-(now-node.windowMs))/node.windowMs*(right-left),baseline-value*extent] as const);
    line(p,points,p.colors.accent,2);
    // The head marks the observation time. It never creates a beat on its own.
    line(p,[[right,baseline-extent-10],[right,baseline+extent*.55]],p.colors.guide,1);
    p.ctx.beginPath();p.ctx.arc(right,points[points.length-1][1],2.5,0,Math.PI*2);p.ctx.fillStyle=p.colors.accent;p.ctx.fill();
  }else for(const e of events){
    const x=left+(1-(now-e.atMs)/node.windowMs)*(right-left),amplitude=extent*Math.min(1,.36+Math.log2(e.addedGraphemes+1)*.16);
    line(p,[[x,baseline+amplitude*.22],[x,baseline-amplitude]],p.colors.accent,2);
    p.ctx.beginPath();p.ctx.arc(x,baseline-amplitude,2.4,0,Math.PI*2);p.ctx.fillStyle=p.colors.accent;p.ctx.fill();
  }
  text(p,`${events.length}`,18,60,22,p.colors.text,{numeric:true,weight:700});
  text(p,`COMMITTED EVENTS / ${node.windowMs/1000}s`,56,58,9,p.colors.muted,{maxWidth:p.width-74});
  text(p,`−${node.windowMs/1000}s`,left,p.height-43,9,p.colors.muted,{numeric:true});
  text(p,staticView?'STATIC':p.state.status==='paused'?'FROZEN':'NOW',right,p.height-43,9,p.colors.muted,{align:'right',numeric:true});
  footnote(p,node.description??'Input rhythm · event-driven display, not physiological data');
}
