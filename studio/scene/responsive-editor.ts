import {parseArrangement,type Arrangement,type Movable,type Rect} from './transparent-layout';
import {PORTRAIT_WIDTH,PORTRAIT_HEIGHT,PORTRAIT_RECTS,portraitRects,portraitContentBottom,responsiveLayout} from './responsive-layout';

type Dock='top-left'|'top-right'|'bottom-left'|'bottom-right';
const minimumWidth:Record<Movable,number>={media:120,inset:96,subtitle:160,metrics:144};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const finite=(value:number,fallback:number)=>Number.isFinite(value)?value:fallback;

export const portraitRectFor=(key:Movable,arrangement:Arrangement,height=PORTRAIT_HEIGHT):Rect=>responsiveLayout(true,arrangement,'lesson',height)[key];

/** Every editable item stays above the fixed input console and player. */
export function constrainPortraitRect(key:Movable,candidate:Rect,height=PORTRAIT_HEIGHT):Rect{
 const base=portraitRects(height)[key],contentBottom=portraitContentBottom(height);
 const candidateRatio=candidate.w/candidate.h;
 const hasAspect=candidate.w>0&&candidate.h>0&&Number.isFinite(candidateRatio)&&candidateRatio>0;
 const ratio=hasAspect?candidateRatio:base.w/base.h;
 const maxWidth=Math.min(PORTRAIT_WIDTH,contentBottom*ratio);
 // A very tall item can hit the height limit before its nominal minimum width.
 const w=clamp(finite(candidate.w,base.w),Math.min(minimumWidth[key],maxWidth),maxWidth),h=hasAspect&&w===candidate.w?candidate.h:w/ratio;
 return{x:clamp(finite(candidate.x,base.x),0,PORTRAIT_WIDTH-w),y:clamp(finite(candidate.y,base.y),0,contentBottom-h),w,h};
}

export function movePortraitRect(key:Movable,rect:Rect,dx:number,dy:number,height=PORTRAIT_HEIGHT):Rect{
 return constrainPortraitRect(key,{...rect,x:rect.x+dx,y:rect.y+dy},height);
}

export function scalePortraitRect(key:Movable,rect:Rect,deltaWidth:number,height=PORTRAIT_HEIGHT):Rect{
 const current=constrainPortraitRect(key,rect,height),w=Math.max(1,current.w+deltaWidth);
 return constrainPortraitRect(key,{...current,w,h:current.h*w/current.w},height);
}

export function dockPortraitRect(key:Movable,rect:Rect,dock:Dock,height=PORTRAIT_HEIGHT):Rect{
 const next=constrainPortraitRect(key,rect,height);
 return constrainPortraitRect(key,{...next,x:dock.endsWith('right')?PORTRAIT_WIDTH-next.w:0,y:dock.startsWith('bottom')?portraitContentBottom(height)-next.h:0},height);
}

export function keyboardPortraitRect(key:Movable,rect:Rect,code:string,shift=false,height=PORTRAIT_HEIGHT):Rect|null{
 const step=shift?20:4;
 if(code==='ArrowLeft')return movePortraitRect(key,rect,-step,0,height);
 if(code==='ArrowRight')return movePortraitRect(key,rect,step,0,height);
 if(code==='ArrowUp')return movePortraitRect(key,rect,0,-step,height);
 if(code==='ArrowDown')return movePortraitRect(key,rect,0,step,height);
 if(code==='+'||code==='=')return scalePortraitRect(key,rect,shift?100:25,height);
 if(code==='-'||code==='_')return scalePortraitRect(key,rect,shift?-100:-25,height);
 return null;
}

/** Saved portrait positions have their own coordinate space and storage key. */
export function parsePortraitArrangement(value:unknown,height=PORTRAIT_HEIGHT):Arrangement{
 if(!value||typeof value!=='object')return{};
 const result:Arrangement={};
 for(const key of Object.keys(PORTRAIT_RECTS)as Movable[]){
  const rect=(value as Arrangement)[key];
  if(rect&&['x','y','w','h'].every(field=>typeof rect[field as keyof Rect]==='number'&&Number.isFinite(rect[field as keyof Rect])))result[key]=constrainPortraitRect(key,rect,height);
 }
 return result;
}

export function parseResponsiveArrangement(value:unknown,portrait=false,height=PORTRAIT_HEIGHT):Arrangement{
 return portrait?parsePortraitArrangement(value,height):parseArrangement(value);
}

export function portraitPointerDelta(dx:number,dy:number,cssWidth:number,cssHeight:number,height=PORTRAIT_HEIGHT){
 return{dx:cssWidth>0?dx*PORTRAIT_WIDTH/cssWidth:0,dy:cssHeight>0?dy*height/cssHeight:0};
}

export function portraitRectStyle(rect:Rect,height=PORTRAIT_HEIGHT){
 return{left:`${rect.x/PORTRAIT_WIDTH*100}%`,top:`${rect.y/height*100}%`,width:`${rect.w/PORTRAIT_WIDTH*100}%`,height:`${rect.h/height*100}%`};
}
