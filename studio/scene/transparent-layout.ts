/** Transparent v6 coordinates are independent of the archived v22 preference. */
import type {Arrangement,Movable,Rect} from './layout';
export type {Arrangement,Movable,Rect} from './layout';
export {rectStyle} from './layout';
export const LAYOUT_NAMES:Record<Movable,string>={media:'主画面',inset:'摄像头 / 课程小窗',subtitle:'字幕',metrics:'输入节奏'};
export const DEFAULT_RECTS:Record<Movable,Rect>={media:{x:0,y:0,w:1672,h:941},inset:{x:1374,y:292,w:240,h:152},subtitle:{x:686,y:646,w:300,h:49},metrics:{x:50,y:546,w:309,h:168}};
export const SPLIT_INSET:Rect={x:1150,y:292,w:464,h:300};
export const CONSOLE_RECT:Rect={x:479,y:752,w:722,h:127};
export const PLAYER_RECT:Rect={x:479,y:883,w:722,h:58};
/** Input controls share y832; the line-only player spans the same 722px below. */
export const ZONES={input:{x:499,y:800,w:473,h:64},submit:{x:986,y:800,w:193,h:64},play:{x:483,y:890,w:44,h:44},previous:{x:531,y:890,w:44,h:44},seek:{x:581,y:883,w:522,h:57},next:{x:1109,y:890,w:44,h:44},mute:{x:1157,y:890,w:44,h:44},title:{x:627,y:38,w:418,h:76}};
/** Wide cue targets stay inside the stage; drags use the same visual rail. */
export const cueMarkerRect=(ratio:number):Rect=>({x:ZONES.seek.x+20+Math.max(0,Math.min(1,ratio))*(ZONES.seek.w-40)-19,y:896,w:38,h:44});
export function timelinePointerProgress(clientX:number,stageLeft:number,stageWidth:number){return Math.max(0,Math.min(1,((clientX-stageLeft)*1672/stageWidth-ZONES.seek.x-20)/(ZONES.seek.w-40)))}
export const rectFor=(key:Movable,a:Arrangement):Rect=>({...DEFAULT_RECTS[key],...a[key]});
export const insetRect=(layout:'lesson'|'camera'|'split',a:Arrangement={}):Rect=>({...a.inset??(layout==='split'?SPLIT_INSET:DEFAULT_RECTS.inset)});
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export function constrainRect(key:Movable,r:Rect):Rect{
 const base=DEFAULT_RECTS[key],ratio=r.w>0&&r.h>0?r.w/r.h:base.w/base.h;
 const height=key==='media'?941:724,min=key==='media'?300:key==='inset'?180:key==='subtitle'?280:250;
 const w=clamp(Number.isFinite(r.w)?r.w:base.w,min,Math.min(1672,height*ratio)),h=w/ratio;
 return{x:clamp(Number.isFinite(r.x)?r.x:base.x,0,1672-w),y:clamp(Number.isFinite(r.y)?r.y:base.y,0,height-h),w,h};
}
export const scaleRect=(key:Movable,r:Rect,delta:number)=>constrainRect(key,{...r,w:Math.max(1,r.w+delta),h:Math.max(1,r.w+delta)*r.h/r.w});
export const moveRect=(key:Movable,r:Rect,dx:number,dy:number)=>constrainRect(key,{...r,x:r.x+dx,y:r.y+dy});
export function dockRect(key:Movable,r:Rect,dock:'top-left'|'top-right'|'bottom-left'|'bottom-right'){const next=constrainRect(key,r);return constrainRect(key,{...next,x:dock.endsWith('right')?1672-next.w:0,y:dock.startsWith('bottom')?(key==='media'?941:724)-next.h:0})}
export function keyboardRect(key:Movable,r:Rect,code:string,shift=false):Rect|null{const d=shift?20:4;if(code==='ArrowLeft')return moveRect(key,r,-d,0);if(code==='ArrowRight')return moveRect(key,r,d,0);if(code==='ArrowUp')return moveRect(key,r,0,-d);if(code==='ArrowDown')return moveRect(key,r,0,d);if(code==='+'||code==='=')return scaleRect(key,r,shift?100:25);if(code==='-'||code==='_')return scaleRect(key,r,shift?-100:-25);return null}
export function parseArrangement(value:unknown):Arrangement{if(!value||typeof value!=='object')return{};const out:Arrangement={};for(const key of Object.keys(DEFAULT_RECTS)as Movable[]){const r=(value as Arrangement)[key];if(r&&['x','y','w','h'].every(k=>typeof r[k as keyof Rect]==='number'&&Number.isFinite(r[k as keyof Rect])))out[key]=constrainRect(key,r)}return out}
