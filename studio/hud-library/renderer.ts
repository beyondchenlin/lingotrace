import { resolveAnchoredRect } from './layout.ts';
import { resolveStyle } from './tokens.ts';
import { effectiveState, formatNumber } from './metrics.ts';
import { validateScene } from './validate.ts';
import { header, type Paint } from './components/shared.ts';
import { paintNumeric } from './components/numeric.ts';
import { paintTrend } from './components/trend.ts';
import { paintTrendBars } from './components/trend-bars.ts';
import { paintProgressTrack } from './components/progress-track.ts';
import { paintInputPulse } from './components/pulse.ts';
import { paintProgress } from './components/progress.ts';
import { paintBar } from './components/bar.ts';
import { paintTargetBand, targetPosition } from './components/target-band.ts';
import { paintCalendar } from './components/calendar.ts';
import type { HudMetric, HudNode, HudScene, RenderClock, RenderedNode } from './schema.ts';
function accessibleText(node: HudNode, metric: HudMetric) {
  const state=effectiveState(metric), source=metric.source==='fixture'?'Fixture demonstration. ':'';
  const prefix=`${source}${node.label}. ${state.status}. ${metric.quality}. `;
  if(state.status==='no-data'&&metric.kind==='target-band'&&metric.value!==null&&metric.quality!=='unmeasured'&&metric.state.status!=='no-data')return prefix+`Actual value ${metric.value} ${metric.unit}. Target interval not provided.`;
  if(state.status==='no-data'&&metric.kind==='calendar')return prefix+`${metric.startDate} to ${metric.endDate}; ${metric.timezone}. Observations unavailable; explicit dates shown as unknown, never zero.`;
  if(state.status==='error'||state.status==='no-data') return prefix+(state.message??'No observation provided.');
  switch(metric.kind){
    case 'number':return prefix+`${formatNumber(metric.value!,node.type==='numeric'?node.precision:0)} ${metric.unit}.`;
    case 'progress':return prefix+`${metric.numerator} of ${metric.denominator} ${metric.unit}.`;
    case 'input-pulse':return prefix+'Committed typing and IME input events; waveform shape is a display effect, not a heart-rate signal.';
    case 'bar':return prefix+`${metric.grouping.label}. ${metric.unit}. `+metric.groups.map(g=>`${g.label}: ${g.value===null?'unknown':g.value}, ${g.coverage} coverage${g.interval?`, interval ${g.interval.start} to ${g.interval.end} ${metric.grouping.intervalUnit}`:''}`).join('; ');
    case 'target-band':return prefix+`Actual value ${metric.value} ${metric.unit}. Target ${metric.target.min} to ${metric.target.max}. ${targetPosition(metric)} target.${metric.value!<metric.scale.min||metric.value!>metric.scale.max?' Outside display scale; actual value preserved.':''}`;
    case 'calendar':return prefix+`${metric.startDate} to ${metric.endDate}; ${metric.timezone}; ${metric.weekStartsOn} week start; ${metric.unit}. `+metric.days.map(d=>`${d.date}: ${d.value===null?'unknown':d.value}, ${d.coverage} coverage`).join('; ');
    case 'trend':return prefix+`${metric.points.filter(p=>p.value!==null&&p.quality!=='unmeasured'&&p.atMs>=metric.domain.startMs&&p.atMs<=metric.domain.endMs&&p.state!=='paused'&&p.state!=='missing').length} supplied observations in ${metric.unit}. Gaps are not zero values.`;
  }
}
/** Shared compositor for preview and recording. Caller owns canvas size, DPR, clocks, fonts and scheduling. */
export function renderHudScene(ctx: CanvasRenderingContext2D,scene: HudScene,clock: RenderClock,options: Readonly<{clear?:boolean}>={}): readonly RenderedNode[] {
  const errors=validateScene(scene,clock);if(errors.length)throw new Error(`Invalid HUD scene:\n${errors.join('\n')}`);
  const results:RenderedNode[]=[];ctx.save();
  try{
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.setLineDash([]);ctx.lineDashOffset=0;
    ctx.shadowBlur=0;ctx.shadowColor='#00000000';ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;ctx.filter='none';ctx.direction='ltr';
    ctx.letterSpacing='0px';ctx.wordSpacing='0px';ctx.fontKerning='normal';ctx.fontStretch='normal';ctx.fontVariantCaps='normal';ctx.textRendering='auto';
    if(options.clear)ctx.clearRect(0,0,scene.size.width,scene.size.height);
    ctx.beginPath();ctx.rect(scene.safeBounds.x,scene.safeBounds.y,scene.safeBounds.width,scene.safeBounds.height);ctx.clip();
    const sorted=[...scene.nodes].sort((a,b)=>a.zIndex-b.zIndex||(a.id<b.id?-1:a.id>b.id?1:0));
    for(const node of sorted){
      const metric=scene.metrics[node.metricBinding.metricKey],state=effectiveState(metric),rect=resolveAnchoredRect(node.position,node.size,node.anchor),style=resolveStyle(node.style);
      ctx.save();try{
        ctx.translate(rect.x,rect.y);ctx.beginPath();ctx.rect(0,0,rect.width,rect.height);ctx.clip();ctx.globalAlpha*=style.opacity;
        const plate=node.style?.backplate;if(plate){ctx.save();ctx.globalAlpha*=plate.opacity;ctx.fillStyle=plate.color;ctx.fillRect(0,0,rect.width,rect.height);ctx.restore();}
        const p:Paint={ctx,node,colors:style.colors,font:style.font,width:rect.width,height:rect.height,state,quality:metric.quality,source:metric.source};header(p);
        if(node.type==='numeric'&&metric.kind==='number')paintNumeric(p,node,metric);
        else if(node.type==='trend-line'&&metric.kind==='trend')paintTrend(p,node,metric);
        else if(node.type==='trend-bars'&&metric.kind==='trend')paintTrendBars(p,metric);
        else if(node.type==='input-pulse'&&metric.kind==='input-pulse')paintInputPulse(p,node,metric,clock);
        else if(node.type==='progress-ring'&&metric.kind==='progress')paintProgress(p,node,metric);
        else if(node.type==='progress-track'&&metric.kind==='progress')paintProgressTrack(p,node,metric);
        else if(node.type==='bar-chart'&&metric.kind==='bar')paintBar(p,metric);
        else if(node.type==='target-band'&&metric.kind==='target-band')paintTargetBand(p,metric);
        else if(node.type==='calendar-heatmap'&&metric.kind==='calendar')paintCalendar(p,metric);
      }finally{ctx.restore();}
      results.push({id:node.id,type:node.type,rect,status:state.status,accessibleText:accessibleText(node,metric)});
    }
  }finally{ctx.restore();}
  return results;
}
