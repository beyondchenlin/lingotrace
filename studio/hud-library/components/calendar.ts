import type { CalendarMetric, DataCoverage } from '../schema.ts';
import { calendarCells } from '../calendar.ts';
import { formatSuppliedNumber } from '../metrics.ts';
import { empty, footnote, line, text, type Paint } from './shared.ts';
function cell(p:Paint,x:number,y:number,size:number,value:number|null,coverage:DataCoverage,max:number){
  const c=p.ctx,gap=3,w=size-gap;
  if(coverage==='unknown'){
    c.strokeStyle=p.colors.guide;c.lineWidth=1;c.strokeRect(x+.5,y+.5,w-1,w-1);
    line(p,[[x+3,y+w-3],[x+w-3,y+3]],p.colors.muted,.8);return;
  }
  c.save();c.fillStyle=p.colors.accent;c.globalAlpha*=value===null?.05:value===0?.1:.2+.8*(value/max);c.fillRect(x,y,w,w);c.restore();
  if(value===0){c.strokeStyle=p.colors.guide;c.lineWidth=1;c.strokeRect(x+.5,y+.5,w-1,w-1);}
  if(coverage==='partial'){
    line(p,[[x+1,y+w-2],[x+w-2,y+1]],p.colors.warning,.9);
    c.fillStyle=p.colors.warning;c.fillRect(x+w-3,y,3,3);
  }
}
export function paintCalendar(p:Paint,metric:CalendarMetric){
  if(p.state.status==='error'){empty(p);return;}
  const layout=calendarCells(metric.startDate,metric.endDate,metric.weekStartsOn),columns=layout.at(-1)!.column+1;
  const left=48,top=74,size=Math.min(22,(p.width-left-18)/columns,(p.height-top-61)/7),c=p.ctx;
  const unavailable=p.state.status==='no-data';
  text(p,`${metric.startDate} → ${metric.endDate}`,18,43,10,p.colors.text,{numeric:true,maxWidth:p.width-36});
  text(p,`${metric.timezone} · ${metric.unit} · ${metric.weekStartsOn==='monday'?'MON':'SUN'} START`,18,59,9,p.colors.muted,{maxWidth:p.width-36});
  const labels=metric.weekStartsOn==='monday'?['M','T','W','T','F','S','S']:['S','M','T','W','T','F','S'];
  labels.forEach((label,row)=>text(p,label,left-12,top+row*size+size*.63,8,p.colors.muted,{align:'right'}));
  for(const [i,position] of layout.entries()){
    const day=metric.days[i];cell(p,left+position.column*size,top+position.row*size,size,unavailable?null:day.value,unavailable?'unknown':day.coverage,metric.colorDomain.max);
  }
  const legendY=p.height-39;
  cell(p,18,legendY-9,12,0,'complete',metric.colorDomain.max);text(p,'0',33,legendY,8,p.colors.muted);
  cell(p,55,legendY-9,12,null,'unknown',metric.colorDomain.max);text(p,'unknown',70,legendY,8,p.colors.muted);
  cell(p,131,legendY-9,12,0,'partial',metric.colorDomain.max);text(p,'partial',146,legendY,8,p.colors.muted);
  c.fillStyle=p.colors.accent;c.fillRect(p.width-87,legendY-9,10,9);text(p,`≤ ${formatSuppliedNumber(metric.colorDomain.max)}`,p.width-18,legendY,8,p.colors.muted,{align:'right',maxWidth:62});
  footnote(p,unavailable?'NO OBSERVED HISTORY / explicit dates remain unknown':'SUPPLIED DAILY VALUES / zero ≠ unknown ≠ partial');
}
