import type { TargetBandMetric } from '../schema.ts';
import { formatSuppliedNumber } from '../metrics.ts';
import { empty, footnote, line, text, unavailable, type Paint } from './shared.ts';
export function targetPosition(metric:TargetBandMetric):'below'|'inside'|'above'|'unknown'{
  if(metric.value===null||metric.target.min===null||metric.target.max===null)return 'unknown';
  return metric.value<metric.target.min?'below':metric.value>metric.target.max?'above':'inside';
}
export function paintTargetBand(p:Paint,metric:TargetBandMetric){
  if(unavailable(p)){
    if(p.state.status==='no-data'&&metric.value!==null&&metric.quality!=='unmeasured'&&metric.state.status!=='no-data'){text(p,formatSuppliedNumber(metric.value),18,p.height*.53,34,p.colors.text,{numeric:true,weight:700,maxWidth:p.width-36});text(p,metric.unit,18,p.height*.53+22,10,p.colors.muted);footnote(p,'TARGET INTERVAL NOT PROVIDED / actual value only');}
    else empty(p);return;
  }
  const c=p.ctx,value=metric.value!,target=metric.target,scale=metric.scale,left=18,right=p.width-18,y=p.height*.61;
  const px=(v:number)=>left+(v-scale.min)/(scale.max-scale.min)*(right-left),position=targetPosition(metric),warning=position!=='inside';
  text(p,formatSuppliedNumber(value),left,Math.min(y-26,82),Math.min(38,p.font.valueSize),p.colors.text,{numeric:true,weight:700,maxWidth:p.width*.55});
  text(p,metric.unit.toUpperCase(),right,Math.min(y-26,77),10,p.colors.muted,{align:'right'});
  line(p,[[left,y],[right,y]],p.colors.track,7);
  const start=px(target.min!),end=px(target.max!);line(p,[[start,y],[end,y]],p.colors.accentSoft,12);
  line(p,[[start,y-10],[start,y+10]],p.colors.accent,1);line(p,[[end,y-10],[end,y+10]],p.colors.accent,1);
  const outside=value<scale.min||value>scale.max,x=value<scale.min?left:value>scale.max?right:px(value);
  c.fillStyle=warning?p.colors.warning:p.colors.accent;c.beginPath();
  if(outside){const direction=value<scale.min?-1:1;c.moveTo(x,y-17);c.lineTo(x-direction*8,y-23);c.lineTo(x-direction*8,y-11);}else{c.moveTo(x,y-9);c.lineTo(x-5,y-19);c.lineTo(x+5,y-19);}c.closePath();c.fill();
  text(p,formatSuppliedNumber(scale.min),left,y+28,9,p.colors.muted,{numeric:true});text(p,formatSuppliedNumber(scale.max),right,y+28,9,p.colors.muted,{numeric:true,align:'right'});
  text(p,`TARGET ${formatSuppliedNumber(target.min!)}–${formatSuppliedNumber(target.max!)}`,p.width/2,y+28,9,p.colors.accent,{align:'center',maxWidth:p.width*.65});
  footnote(p,`${position==='inside'?'WITHIN TARGET':position==='below'?'BELOW TARGET':'ABOVE TARGET'}${outside?' / OUTSIDE SCALE':''} · actual value preserved`);
}
