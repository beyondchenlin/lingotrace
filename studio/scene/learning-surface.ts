/** Presentation preferences only. Never written to a training snapshot. */
import type {Rect} from './layout';
import type {StudioGeometry,InputCardGeometry} from './input-card';
import {applyInputCardLayout} from './input-card';
export type KeyboardPlacement='inside'|'below';
export const KEYBOARD_PLACEMENT_STORAGE_KEY='lingotrace-keyboard-placement-v1';
export function parseKeyboardPlacement(value:unknown):KeyboardPlacement{return value==='below'?'below':'inside'}
export type VideoSize='half'|'native'|'fit';
export type HudScaleMode='follow'|'fixed';
export interface HudPreferences {mode:HudScaleMode;size:number}
export const DEFAULT_HUD:HudPreferences={mode:'follow',size:1};
export const HUD_REFERENCE_WIDTH={landscape:960,portrait:430} as const;
const positive=(n:number,fallback:number)=>Number.isFinite(n)&&n>0?n:fallback;
/** 1 CSS pixel per decoded source pixel, clamped on both axes. Fit may upscale.
 * Fullscreen is deliberately absent: it changes the available rectangle only. */
export function fitLearningSurface(options:{availableWidth:number;availableHeight:number;sceneWidth:number;sceneHeight:number;media:Rect;intrinsicWidth?:number;intrinsicHeight?:number;videoSize:VideoSize;portrait?:boolean}){
 const w=positive(options.sceneWidth,1672),h=positive(options.sceneHeight,941),aw=positive(options.availableWidth,1),ah=positive(options.availableHeight,1);
 const iw=positive(options.intrinsicWidth??0,1280),ih=positive(options.intrinsicHeight??0,720);
 const media=options.media,containScale=Math.min(positive(media.w,w)/iw,positive(media.h,h)/ih);
 // Use the contained intrinsic picture height, including its actual aspect,
 // rather than treating the logical Canvas/media rectangle as video pixels.
 const viewportScale=Math.min(aw/w,ah/(ih*containScale));
 const requested=(options.videoSize==='half'?.5:1)/containScale;
 // On physically short views keep controls usable and allow vertical scrolling.
 // The renderer independently caps actual media pixels, so a larger control
 // surface never upscales native/half video or defeats its viewport clamp.
 const readableScale=Math.min(aw/w,(options.portrait?300:560)/w);
 // A portrait learning page fills its available width. Extra input/keyboard
 // height belongs to page flow, never a reason to shrink every HUD and glyph.
 // containLearningMedia independently preserves the requested video scale.
 const scale=options.portrait?aw/w:Math.max(readableScale,options.videoSize==='fit'?viewportScale:Math.min(viewportScale,requested));
 const width=Math.floor(w*scale*100)/100;
 return{width,height:width*h/w,scale:width/w,clamped:scale+1e-6<requested};
}
function around(r:Rect,factor:number,ax:number,ay:number):Rect{return{x:r.x+r.w*ax*(1-factor),y:r.y+r.h*ay*(1-factor),w:r.w*factor,h:r.h*factor}}
/** Preserve each established normalized anchor, with a bounded collision-safe
 * envelope. Small frames report safety clamping instead of cropping content. */
export function projectHudGeometry(base:StudioGeometry,preferences:HudPreferences=DEFAULT_HUD,cssWidth=base.width){
 const cssScale=positive(cssWidth,base.width)/base.width,size=Math.max(.8,Math.min(1.15,positive(preferences.size,1)));
 const desired=size*(preferences.mode==='fixed'?HUD_REFERENCE_WIDTH[base.portrait?'portrait':'landscape']/base.width/cssScale:1);
 const factor=Math.min(base.portrait?1:1.3,desired);
 const goal=around(base.goal,factor,0,0),trend=around(base.trend,factor,1,0),title=around(base.title,factor,.5,0),metrics=around(base.metrics,factor,0,.5),subtitle=around(base.subtitle,factor,.5,.5),counter=around(base.counter,factor,1,1);
 return{...base,goal,trend,title,metrics,subtitle,counter,zones:{...base.zones,title},hudFactor:factor,hudClamped:factor+1e-6<desired};
}
export function learningGeometry(base:StudioGeometry,options:{keyboardVisible:boolean;keyboardPlacement?:KeyboardPlacement;intrinsicWidth?:number;intrinsicHeight?:number;videoSize?:VideoSize;availableWidth?:number;availableHeight?:number;cssWidth?:number;hud?:HudPreferences}){
 const cssWidth=positive(options.cssWidth??base.width,base.width),projected=projectHudGeometry(base,options.hud,cssWidth);
 const picture=containLearningMedia({width:positive(options.intrinsicWidth??0,1280),height:positive(options.intrinsicHeight??0,720)},base.media,cssWidth/base.width,options.videoSize??'native',{width:options.availableWidth??Infinity,height:options.availableHeight??Infinity});
 return{...applyInputCardLayout(projected,{keyboardVisible:options.keyboardVisible,keyboardPlacement:options.keyboardPlacement,mediaBottom:picture.y+picture.h,availableHeight:options.availableHeight,cssScale:cssWidth/base.width}),hudFactor:projected.hudFactor,hudClamped:projected.hudClamped};
}

/** Actual picture pixels stay independent of the larger control/recording surface. */
export function containLearningMedia(intrinsic:{width:number;height:number},rect:Rect,cssScale:number,videoSize:VideoSize,available:{width:number;height:number}={width:Infinity,height:Infinity}):Rect{
 const sw=positive(intrinsic.width,1),sh=positive(intrinsic.height,1),scale=positive(cssScale,1);
 const requested=videoSize==='fit'?Infinity:(videoSize==='half'?.5:1)/scale;
 const factor=Math.min(rect.w/sw,rect.h/sh,requested,available.width/scale/sw,available.height/scale/sh);
 return{x:rect.x+(rect.w-sw*factor)/2,y:rect.y+(rect.h-sh*factor)/2,w:sw*factor,h:sh*factor};
}

/** Keep the reference toggle and opt-in playback near typing, outside its line slots. */
export function inputHeaderControls(card:InputCardGeometry){
 const h=card.helper,gap=6/card.cssScale,w=Math.min(172/card.cssScale,h.w*.48);
 return{reference:{...h,w:h.w-w-gap},follow:{...h,x:h.x+h.w-w,w}};
}

/** Scroll the page to editing and nearby transport without shrinking the learning surface. */
export function learningFocusScroll(viewport:{top:number;bottom:number},input:{top:number;bottom:number},submit?:{top:number;bottom:number},transport?:{top:number;bottom:number},follow?:{top:number;bottom:number}){
 const top=viewport.top+8,bottom=viewport.bottom-8,room=Math.max(0,bottom-top);
 let first=input.top,last=Math.max(input.bottom,submit?.bottom??input.bottom);
 const allFirst=Math.min(first,follow?.top??first),allLast=Math.max(last,transport?.bottom??last);
 if(allLast-allFirst<=room){first=allFirst;last=allLast}
 else if(last-first>room)last=input.bottom;
 return last>bottom?last-bottom:first<top?first-top:0;
}
