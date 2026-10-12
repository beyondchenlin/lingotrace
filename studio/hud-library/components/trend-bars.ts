import type { TrendMetric } from '../schema.ts';
import { formatSuppliedNumber } from '../metrics.ts';
import { empty, footnote, line, text, unavailable, type Paint } from './shared.ts';
export function paintTrendBars(p:Paint,metric:TrendMetric){
  if(unavailable(p)){empty(p);return;}
  const c=p.ctx,d=metric.domain,left=34,right=p.width-18,top=53,bottom=p.height-51;
  const x=(at:number)=>left+(at-d.startMs)/(d.endMs-d.startMs)*(right-left),y=(value:number)=>bottom-(value-d.min)/(d.max-d.min)*(bottom-top),zero=y(0);
  for(const value of [d.max,0,d.min])line(p,[[left,y(value)],[right,y(value)]],value===0?p.colors.guide:p.colors.track,1);
  text(p,formatSuppliedNumber(d.max),24,top+3,9,p.colors.muted,{align:'right',numeric:true,maxWidth:25});
  text(p,formatSuppliedNumber(d.min),24,bottom+3,9,p.colors.muted,{align:'right',numeric:true,maxWidth:25});
  const visible=metric.points.filter(point=>point.atMs>=d.startMs&&point.atMs<=d.endMs);
  for(const [index,point]of visible.entries()){
    const center=x(point.atMs),previous=index>0?center-x(visible[index-1].atMs):Infinity,next=index+1<visible.length?x(visible[index+1].atMs)-center:Infinity;
    const width=Math.max(.5,Math.min(24,Math.min(previous,next)*.58,(right-left)*.1));
    if(point.value===null||point.quality==='unmeasured'||point.state==='missing'||point.state==='paused'){
      c.save();c.setLineDash([2,2]);line(p,[[center-3,bottom+5],[center+3,bottom+5]],p.colors.muted,1);c.restore();continue;
    }
    if(point.value===0){line(p,[[center-3,zero],[center+3,zero]],p.colors.accent,2);continue;}
    const valueY=y(point.value),barLeft=Math.max(left,center-width/2),barRight=Math.min(right,center+width/2);
    c.fillStyle=p.colors.accent;c.fillRect(barLeft,Math.min(zero,valueY),Math.max(.5,barRight-barLeft),Math.abs(zero-valueY));
  }
  text(p,`${(d.startMs/1000).toFixed(0)}s`,left,bottom+20,9,p.colors.muted,{numeric:true});text(p,`${(d.endMs/1000).toFixed(0)}s`,right,bottom+20,9,p.colors.muted,{numeric:true,align:'right'});
  footnote(p,`${metric.unit} · actual timestamps / gaps remain empty`);
}
