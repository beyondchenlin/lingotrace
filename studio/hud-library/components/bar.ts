import type { BarMetric } from '../schema.ts';
import { formatSuppliedNumber } from '../metrics.ts';
import { empty, footnote, line, text, unavailable, type Paint } from './shared.ts';
export function paintBar(p:Paint,metric:BarMetric){
  if(unavailable(p)){empty(p);return;}
  const left=Math.min(112,p.width*.29),right=p.width-108,top=65,bottom=p.height-50,row=(bottom-top)/metric.groups.length;
  text(p,metric.grouping.label.toUpperCase(),18,44,9,p.colors.muted,{maxWidth:p.width-36});
  for(const [i,g] of metric.groups.entries()){
    const y=top+i*row+row*.5,height=Math.max(5,Math.min(13,row*.48));
    const label=metric.grouping.kind==='interval'?`${formatSuppliedNumber(g.interval!.start)}–${formatSuppliedNumber(g.interval!.end)} ${metric.grouping.intervalUnit==='seconds'?'s':'ms'}`:g.label;
    text(p,label,18,y+3,10,p.colors.muted,{maxWidth:left-28});
    line(p,[[left,y],[right,y]],p.colors.track,height);
    if(g.value!==null&&g.coverage!=='unknown'){
      const width=g.value/metric.domain.max*(right-left);
      if(g.value>0)line(p,[[left,y],[left+width,y]],g.coverage==='partial'?p.colors.accentSoft:p.colors.accent,height);
      else line(p,[[left,y-height*.65],[left,y+height*.65]],p.colors.accent,2);
      text(p,formatSuppliedNumber(g.value)+(g.coverage==='partial'?' · partial':''),p.width-18,y+3,g.coverage==='partial'?8:11,p.colors.text,{align:'right',numeric:true,maxWidth:90});
    }else text(p,g.coverage==='partial'?'— · partial':'unknown',p.width-18,y+3,8,p.colors.muted,{align:'right',numeric:true,maxWidth:90});
    if(g.coverage!=='complete'){
      const x=right+11;line(p,[[x-3,y+4],[x+3,y-4]],g.coverage==='partial'?p.colors.warning:p.colors.muted,1);

    }
  }
  footnote(p,`${metric.unit.toUpperCase()} / ${metric.grouping.kind.toUpperCase()} · supplied groups, no aggregation`);
}
