import type { ProgressMetric, ProgressNode } from '../schema.ts';
import { formatNumber, formatSuppliedNumber } from '../metrics.ts';
import { footnote, text, type Paint } from './shared.ts';
export function paintProgress(p: Paint, node: ProgressNode, metric: ProgressMetric) {
  const c=p.ctx, cx=p.width/2, cy=(p.height+13)/2, r=Math.min(p.width*.27,(p.height-89)/2), start=-Math.PI/2;
  const unavailable=p.state.status==='no-data'||p.state.status==='error';
  c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.lineWidth=5;c.strokeStyle=p.colors.track;c.stroke();
  // Quiet interrupted outer scale gives the ring an identity without a card frame.
  for(let i=0;i<40;i++){const a=start+i*Math.PI*2/40;c.beginPath();c.moveTo(cx+Math.cos(a)*(r+9),cy+Math.sin(a)*(r+9));c.lineTo(cx+Math.cos(a)*(r+(i%5===0?15:12)),cy+Math.sin(a)*(r+(i%5===0?15:12)));c.strokeStyle=p.colors.guide;c.lineWidth=1;c.stroke();}
  if(!unavailable){
    const ratio=metric.numerator!/metric.denominator!;
    if(ratio>0){c.beginPath();c.arc(cx,cy,r,start,start+Math.PI*2*Math.min(1,ratio));c.lineWidth=5;c.lineCap='round';c.strokeStyle=p.colors.accent;c.stroke();}
    text(p,`${formatNumber(ratio*100,node.precision)}%`,cx,cy+4,Math.min(34,p.font.valueSize),p.colors.text,{align:'center',numeric:true,weight:700,maxWidth:r*1.65});
    text(p,`${formatSuppliedNumber(metric.numerator!)} / ${formatSuppliedNumber(metric.denominator!)}`,cx,cy+24,10,p.colors.muted,{align:'center',numeric:true,maxWidth:r*1.7});
  }else{
    text(p,p.state.status==='error'?'!':'—',cx,cy+6,32,p.state.status==='error'?p.colors.error:p.colors.muted,{align:'center',numeric:true});
    text(p,p.state.status==='error'?'UNAVAILABLE':'NO TOTAL',cx,cy+25,9,p.colors.muted,{align:'center'});
  }
  footnote(p,'message' in p.state && p.state.message ? p.state.message : node.description ?? `${metric.unit} · explicit numerator / total`);
}
