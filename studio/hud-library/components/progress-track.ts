import type { ProgressMetric, ProgressTrackNode } from '../schema.ts';
import { formatNumber, formatSuppliedNumber } from '../metrics.ts';
import { empty, footnote, line, text, unavailable, type Paint } from './shared.ts';
export function progressTrackReadoutLayout(width:number){
  const left=18,right=width-18,gap=16,contentWidth=width-36,percentWidth=(contentWidth-gap)*.6,ratioWidth=(contentWidth-gap)*.4;
  return{left,right,gap,percentWidth,ratioWidth};
}
export function paintProgressTrack(p:Paint,node:ProgressTrackNode,metric:ProgressMetric){
  if(unavailable(p)){empty(p);return;}
  const c=p.ctx,numerator=metric.numerator!,denominator=metric.denominator!,ratio=numerator/denominator,left=18,right=p.width-18,y=p.height*.63;
  const readout=progressTrackReadoutLayout(p.width);
  text(p,`${formatNumber(ratio*100,node.precision)}%`,left,Math.min(y-18,84),Math.min(40,p.font.valueSize),p.colors.text,{numeric:true,weight:700,maxWidth:readout.percentWidth});
  text(p,`${formatSuppliedNumber(numerator)} / ${formatSuppliedNumber(denominator)}`,right,Math.min(y-20,79),11,p.colors.muted,{numeric:true,align:'right',maxWidth:readout.ratioWidth});
  line(p,[[left,y],[right,y]],p.colors.track,2);
  const fill=left+Math.min(1,ratio)*(right-left);if(ratio>0)line(p,[[left,y],[fill,y]],p.colors.accent,3);
  for(let i=0;i<=10;i++){const x=left+(right-left)*i/10;line(p,[[x,y+7],[x,y+11]],p.colors.guide);}
  if(ratio>1){c.beginPath();c.moveTo(right,y-5);c.lineTo(right-5,y-10);c.lineTo(right-5,y);c.closePath();c.fillStyle=p.colors.warning;c.fill();}
  text(p,'0',left,y+27,9,p.colors.muted,{numeric:true});text(p,'100%',right,y+27,9,p.colors.muted,{numeric:true,align:'right'});
  footnote(p,`${metric.unit} · ${ratio>1?'over supplied target / actual ratio retained':'explicit numerator / total'}`);
}
