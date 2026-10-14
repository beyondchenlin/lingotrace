/** The live Canvas and native controls share these logical coordinates. */
import {CONSOLE_RECT,PLAYER_RECT,ZONES,rectFor,insetRect,cueMarkerRect,timelinePointerProgress,type Arrangement,type Movable,type Rect} from './transparent-layout';

export const PORTRAIT_WIDTH=430;
export const PORTRAIT_HEIGHT=1080;
export const PORTRAIT_MIN_HEIGHT=820;
export const PORTRAIT_MAX_HEIGHT=1400;
export const PORTRAIT_HUD_SCALE=.58;
/** Short phone viewports use the practice one-screen stack (charts collapsed). */
export const PORTRAIT_PRACTICE_COMPACT_BELOW=940;
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
export const resolvePortraitHeight=(height=PORTRAIT_HEIGHT)=>Number.isFinite(height)?clamp(height,PORTRAIT_MIN_HEIGHT,PORTRAIT_MAX_HEIGHT):PORTRAIT_HEIGHT;
export const isPortraitPracticeCompact=(height=PORTRAIT_HEIGHT)=>resolvePortraitHeight(height)<PORTRAIT_PRACTICE_COMPACT_BELOW;
// 940 and taller retain the established anchors. Short screens remove vertical
// gaps while keeping full-width 16:9 media and the established HUD proportions.
const extraHeight=(height:number)=>Math.max(0,resolvePortraitHeight(height)-940);
const expand=(height:number,compact:number,regular:number)=>compact+(regular-compact)*clamp((resolvePortraitHeight(height)-PORTRAIT_MIN_HEIGHT)/(940-PORTRAIT_MIN_HEIGHT));
const hudScale=()=>PORTRAIT_HUD_SCALE;
const inputScale=402/CONSOLE_RECT.w;
const portraitConsole=(height:number):Rect=>({x:14,y:expand(height,626,742)+.9*extraHeight(height),w:402,h:CONSOLE_RECT.h*inputScale});
const portraitTitle=(height:number):Rect=>{const w=expand(height,335,402);return{x:(PORTRAIT_WIDTH-w)/2,y:expand(height,0,14),w,h:w*(352/3)/536}};
export const portraitContentBottom=(height=PORTRAIT_HEIGHT)=>{
 if(isPortraitPracticeCompact(height))return portraitPracticeConsole(height).y-8;
 return portraitConsole(height).y-16;
};
/** One-screen practice stack for phone-height portraits: video → input → thin transport. */
function portraitPracticeConsole(height:number):Rect{
 const H=resolvePortraitHeight(height),media=portraitPracticeMedia(H);
 return{x:14,y:media.y+media.h+10,w:402,h:CONSOLE_RECT.h*inputScale};
}
function portraitPracticeMedia(height:number):Rect{
 const titleH=40,mediaW=PORTRAIT_WIDTH,mediaH=mediaW*9/16;
 return{x:0,y:titleH+6,w:mediaW,h:mediaH};
}
function portraitPracticeTitle(height:number):Rect{
 return{x:14,y:4,w:402,h:40};
}
export function portraitRects(height=PORTRAIT_HEIGHT):Record<Movable,Rect>{
 if(isPortraitPracticeCompact(height)){
  const H=resolvePortraitHeight(height),scale=hudScale(),media=portraitPracticeMedia(H);
  // Charts stay addressable for layout editor / expand sheet but sit as slim
  // chips under the title strip; the renderer skips them in practiceCompact.
  return{
   media,
   inset:{x:416-240*scale,y:media.y+8,w:240*scale,h:152*scale},
   metrics:{x:14,y:4,w:44,h:36},
   subtitle:{x:65,y:media.y+media.h-36,w:300,h:28},
  };
 }
 const extra=extraHeight(height),scale=hudScale(),mediaWidth=PORTRAIT_WIDTH;
 return{
  media:{x:(PORTRAIT_WIDTH-mediaWidth)/2,y:expand(height,228,330)+.4*extra,w:mediaWidth,h:mediaWidth*9/16},
  inset:{x:416-240*scale,y:expand(height,182,228),w:240*scale,h:152*scale},
  metrics:{x:14,y:expand(height,478,586)+.6*extra,w:309*scale,h:168*scale},
  subtitle:{x:128,y:expand(height,581,697)+.75*extra,w:300*.58,h:49*.58},
 };
}
export const PORTRAIT_CONTENT_BOTTOM=portraitContentBottom();
export const PORTRAIT_RECTS=portraitRects();
function portraitSplitRects(height:number){const defaults=portraitRects(height),width=270;return{
 media:{x:0,y:defaults.media.y,w:width,h:width*9/16},
 inset:{...defaults.inset,y:defaults.media.y},
};}
export const PORTRAIT_SPLIT_MEDIA=portraitSplitRects(PORTRAIT_HEIGHT).media;
export const PORTRAIT_SPLIT_INSET=portraitSplitRects(PORTRAIT_HEIGHT).inset;
function consoleControl(rect:Rect,consoleRect:Rect):Rect{
 const h=Math.max(44,rect.h*inputScale);
 return{x:consoleRect.x+(rect.x-CONSOLE_RECT.x)*inputScale,y:consoleRect.y+(rect.y-CONSOLE_RECT.y+rect.h/2)*inputScale-h/2,w:rect.w*inputScale,h};
}
function portraitZones(height:number):typeof ZONES{
 if(isPortraitPracticeCompact(height)){
  const H=resolvePortraitHeight(height),consoleRect=portraitPracticeConsole(H);
  const transportTop=H-108,seekY=transportTop,playY=transportTop+48;
  return{
   input:consoleControl(ZONES.input,consoleRect),submit:consoleControl(ZONES.submit,consoleRect),
   play:{x:95,y:playY,w:44,h:44},previous:{x:151,y:playY,w:44,h:44},
   next:{x:207,y:playY,w:44,h:44},mute:{x:291,y:playY,w:44,h:44},
   seek:{x:14,y:seekY,w:402,h:44},title:{...portraitPracticeTitle(H),h:40},
  };
 }
 const consoleRect=portraitConsole(height),extra=extraHeight(height);
 return{
  input:consoleControl(ZONES.input,consoleRect),submit:consoleControl(ZONES.submit,consoleRect),
  play:{x:95,y:expand(height,771,891)+extra,w:44,h:44},previous:{x:151,y:expand(height,771,891)+extra,w:44,h:44},
  next:{x:207,y:expand(height,771,891)+extra,w:44,h:44},mute:{x:291,y:expand(height,771,891)+extra,w:44,h:44},
  seek:{x:14,y:expand(height,708,828)+extra,w:402,h:58},title:{...portraitTitle(height),h:expand(height,60,88)},
 };
}
function portraitRect(key:Movable,arrangement:Arrangement,fallback:Rect,height:number):Rect{
 const candidate=arrangement[key];
 if(!candidate||![candidate.x,candidate.y,candidate.w,candidate.h].every(Number.isFinite)||candidate.w<=0||candidate.h<=0)return{...fallback};
 // Bound independent portrait preferences without changing their aspect ratio
 // or mutating saved data. The editor uses this same height-dependent limit.
 const bottom=portraitContentBottom(height),scale=Math.min(1,PORTRAIT_WIDTH/candidate.w,bottom/candidate.h),w=candidate.w*scale,h=candidate.h*scale;
 return{x:clamp(candidate.x,0,PORTRAIT_WIDTH-w),y:clamp(candidate.y,0,bottom-h),w,h};
}
export function responsiveLayout(portrait:boolean,arrangement:Arrangement={},layout:'lesson'|'camera'|'split'='lesson',portraitHeight=PORTRAIT_HEIGHT){
 const width=portrait?PORTRAIT_WIDTH:1672,height=portrait?resolvePortraitHeight(portraitHeight):941;
 const defaults=portraitRects(height),split=portraitSplitRects(height),zones=portrait?portraitZones(height):ZONES,scale=hudScale();
 const compact=portrait&&isPortraitPracticeCompact(height);
 const media=portrait?portraitRect('media',arrangement,layout==='split'?split.media:defaults.media,height):arrangement.media??(layout==='split'?{x:0,y:0,w:1133,h:735}:rectFor('media',arrangement));
 return{
  width,height,portrait,practiceCompact:compact,media,
  inset:portrait?portraitRect('inset',arrangement,layout==='split'?split.inset:defaults.inset,height):insetRect(layout,arrangement),
  metrics:portrait?portraitRect('metrics',arrangement,defaults.metrics,height):rectFor('metrics',arrangement),
  subtitle:portrait?portraitRect('subtitle',arrangement,defaults.subtitle,height):rectFor('subtitle',arrangement),
  console:portrait?(compact?portraitPracticeConsole(height):portraitConsole(height)):CONSOLE_RECT,
  player:portrait?{x:14,y:zones.seek.y,w:402,h:compact?H_transport(height):107}:PLAYER_RECT,
  goal:portrait?(compact?{x:14,y:4,w:44,h:36}:{x:14,y:expand(height,64,104),w:264*scale,h:264*scale}):{x:32,y:54,w:264,h:264},
  title:portrait?(compact?portraitPracticeTitle(height):portraitTitle(height)):{x:568,y:38,w:536,h:352/3},
  trend:portrait?(compact?{x:372,y:4,w:44,h:36}:{x:416-352*scale,y:expand(height,64,104),w:352*scale,h:192*scale}):{x:1297,y:40,w:352,h:192},
  counter:portrait?(compact?{x:386,y:height-28,w:30,h:20}:{x:416-69*scale,y:expand(height,580,700)+.75*extraHeight(height),w:69*scale,h:65*scale}):{x:1575,y:845,w:69,h:65},
  zones,inputScale:portrait?inputScale:1,
  style:(rect:Rect)=>({left:`${rect.x/width*100}%`,top:`${rect.y/height*100}%`,width:`${rect.w/width*100}%`,height:`${rect.h/height*100}%`}),
  cueMarker:(ratio:number):Rect=>portrait?{x:zones.seek.x+20+clamp(ratio)*(zones.seek.w-40)-12,y:zones.seek.y+(compact?4:22),w:24,h:compact?36:36}:cueMarkerRect(ratio),
  timelineProgress:(clientX:number,left:number,cssWidth:number)=>portrait?clamp(((clientX-left)*width/cssWidth-zones.seek.x-20)/(zones.seek.w-40)):timelinePointerProgress(clientX,left,cssWidth),
 };
}
function H_transport(height:number){return resolvePortraitHeight(height)-portraitZones(height).seek.y;}
