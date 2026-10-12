export type Movable='media'|'inset'|'subtitle'|'metrics';
export type Rect={x:number;y:number;w:number;h:number};
export type Arrangement=Partial<Record<Movable,Rect>>;
export const LAYOUT_NAMES:Record<Movable,string>={media:'主画面',inset:'摄像头 / 课程小窗',subtitle:'字幕',metrics:'训练数据带'};
export const REFERENCE_INSET:Readonly<Rect>=Object.freeze({x:1378,y:46,w:273,h:218});
export const SPLIT_INSET:Readonly<Rect>=Object.freeze({x:1103,y:88,w:569,h:522});
export const DEFAULT_RECTS:Record<Movable,Rect>={media:{x:0,y:0,w:1672,h:941},inset:{x:1378,y:108,w:273,h:218},subtitle:{x:453,y:521,w:766,h:73},metrics:{x:0,y:754,w:1672,h:118}};
const limits:Record<Movable,{min:number;bounds:Rect}>={media:{min:300,bounds:{x:0,y:0,w:1672,h:941}},inset:{min:240,bounds:{x:0,y:0,w:1672,h:610}},subtitle:{min:600,bounds:{x:0,y:89,w:1672,h:521}},metrics:{min:1137,bounds:{x:0,y:89,w:1672,h:783}}};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export const rectFor=(key:Movable,arrangement:Arrangement):Rect=>({...DEFAULT_RECTS[key],...arrangement[key]});
/** Shared by Canvas/recording and its DOM hit target. Saved positions are never migrated. */
export function insetRect(layout:'lesson'|'camera'|'split',arrangement:Arrangement={},reference=false):Rect{
 return{...(reference?REFERENCE_INSET:arrangement.inset??(layout==='split'?SPLIT_INSET:DEFAULT_RECTS.inset))};
}
export function constrainRect(key:Movable,candidate:Rect):Rect{
 const base=DEFAULT_RECTS[key],ratio=(key==='media'||key==='inset')&&candidate.w>0&&candidate.h>0?candidate.w/candidate.h:base.w/base.h,{bounds:b,min}=limits[key];
 const maxW=Math.min(b.w,b.h*ratio),w=clamp(Number.isFinite(candidate.w)?candidate.w:base.w,min,maxW),h=w/ratio;
 const x=clamp(Number.isFinite(candidate.x)?candidate.x:base.x,b.x,b.x+b.w-w);
 let y=clamp(Number.isFinite(candidate.y)?candidate.y:base.y,b.y,b.y+b.h-h);
 // Keep the real input console and player usable. A moved metric strip has two safe lanes.
 if(key==='metrics'&&y<754&&y+h>610){const upper=610-h,lower=754;y=Math.abs(y-upper)<=Math.abs(y-lower)?upper:Math.min(lower,b.y+b.h-h)}
 return{x,y,w,h};
}
export function moveRect(key:Movable,r:Rect,dx:number,dy:number){return constrainRect(key,{...r,x:r.x+dx,y:r.y+dy})}
export function scaleRect(key:Movable,r:Rect,deltaWidth:number){const w=Math.max(1,r.w+deltaWidth);return constrainRect(key,{...r,w,h:r.h*w/r.w})}
export function dockRect(key:Movable,r:Rect,dock:'top-left'|'top-right'|'bottom-left'|'bottom-right'){
 const next=constrainRect(key,r),b=limits[key].bounds;return constrainRect(key,{...next,x:dock.endsWith('right')?b.x+b.w-next.w:b.x,y:dock.startsWith('bottom')?b.y+b.h-next.h:b.y});
}
export function keyboardRect(key:Movable,r:Rect,code:string,shift=false):Rect|null{
 const step=shift?20:4;
 if(code==='ArrowLeft')return moveRect(key,r,-step,0);if(code==='ArrowRight')return moveRect(key,r,step,0);if(code==='ArrowUp')return moveRect(key,r,0,-step);if(code==='ArrowDown')return moveRect(key,r,0,step);
 if(code==='+'||code==='=')return scaleRect(key,r,shift?100:25);if(code==='-'||code==='_')return scaleRect(key,r,shift?-100:-25);return null;
}
export function parseArrangement(value:unknown):Arrangement{
 if(!value||typeof value!=='object')return{};const out:Arrangement={};for(const key of Object.keys(DEFAULT_RECTS) as Movable[]){const r=(value as Arrangement)[key];if(r&&['x','y','w','h'].every(k=>typeof r[k as keyof Rect]==='number'&&Number.isFinite(r[k as keyof Rect])))out[key]=constrainRect(key,r)}return out;
}
export function rectStyle(r:Rect){return{left:`${r.x/1672*100}%`,top:`${r.y/941*100}%`,width:`${r.w/1672*100}%`,height:`${r.h/941*100}%`}}
