import {translate,type StudioLocale} from '../i18n/locale';
/** Runtime-only input presentation. Nothing in this file is a training fact. */
import type {Rect} from './layout';
import type {Attempt} from '../core/training';
import {STUDIO_SANS} from './fonts';
import {referenceGuideText,layoutReferenceRemainder} from './reference-guide';
import {inputLetterFeedback} from './live-letter-feedback';
import {typingErrorShakeOffset} from './typing-error-cues';
export {submittedErrorRanges} from './live-letter-feedback';
const INPUT_FONT='"Lingo Studio Mono", "Courier New", "Microsoft YaHei", monospace';
import type {responsiveLayout} from './responsive-layout';

export type StudioGeometry=ReturnType<typeof responsiveLayout>;
export interface KeyboardFeedback {
 visible:boolean;
 /** Observed physical event.code values, never inferred from the reference. */
 codes:string[];
 committedUntil:number;
 composing:boolean;
}
export interface InputCardGeometry {
 card:Rect;
 input:Rect;
 submit:Rect;
 status:Rect;
 helper:Rect;
 toggle:Rect;
 modeToggle:Rect;
 keyboard:Rect|null;
 fontSize:number;
 lineHeight:number;
 paddingX:number;
 paddingY:number;
 stageHeight:number;
 playerOffsetY:number;
 overlayKeyboard?:boolean;
 /** Landscape editor/transport stay on their own surface when Below adds a keyboard. */
 overlayControls?:boolean;
 playerTop?:number;
 portrait:boolean;
 cssScale:number;
}
export interface NativeInputLine {start:number;end:number;text:string;x:number;y:number;width:number;height:number;baseline:number}
export interface NativeInputDisplay {
 /** The entire native draft, including real line breaks; never a cropped tail. */
 text:string;
 lines:NativeInputLine[];
 selection:Rect[];
 caret:Rect;
 /** Native end of the complete draft, independent of the current selection. */
 draftEnd?:Rect&{baseline:number};
 scrollLeft:number;
 scrollTop:number;
 width:number;
 height:number;
 font:string;
 letterSpacing:number;
 lineHeight:number;
 paddingX:number;
 paddingY:number;
 reference?:{text:string;lines:NativeInputLine[]};
 /** View-only native line page. Full draft/reference snapshots remain intact. */
 window?:{firstLine:number;lineCount:number;clipTop:number;clipBottom:number};
}
export interface InputCardOptions {keyboardVisible?:boolean;keyboardPlacement?:'inside'|'below';mediaBottom?:number;availableHeight?:number;cssScale?:number}

/** One shared, text-first editor geometry. Video pixels and stored layout stay unchanged. */
export function inputCardGeometry(base:StudioGeometry,options:InputCardOptions={}):InputCardGeometry{
 const visible=options.keyboardVisible!==false,scale=Number.isFinite(options.cssScale)&&options.cssScale!>0?options.cssScale!:1;
 const touch=Math.max(44,44/scale);
 // Enlarge the glyphs, not an empty wrapper: 46 CSS px on the ordinary 1280px
 // learning surface, with a 30–64px landscape / 28–38px portrait clamp.
 const fontSize=Math.max((base.portrait?28:30)/scale,Math.min(base.portrait?34:60,(base.portrait?38:64)/scale)),lineHeight=fontSize*1.25;
 const paddingX=Math.max(base.portrait?8:12,6/scale),paddingY=Math.max(base.portrait?7:8,6/scale),outer=Math.max(base.portrait?8:20,6/scale),gap=Math.max(6,5/scale);
 const practiceCompact=!!(base as {practiceCompact?:boolean}).practiceCompact;
 const width=base.portrait?base.width-20:Math.min(base.width*.9,2*(base.counter.x-1/scale-base.width/2+outer)),x=(base.width-width)/2,y=base.portrait?base.console.y-4:724;
 const header=Math.max(practiceCompact?36:44,44/scale),inputLines=base.portrait?(practiceCompact?2:3):2,inputHeight=lineHeight*inputLines+paddingY*2;
 const input={x:x+outer,y:y+header,w:width-outer*2,h:inputHeight};
 const submitWidth=Math.max(touch,86/scale);
 const submit={x:x+width-outer-submitWidth,y:input.y+input.h+gap,w:submitWidth,h:touch};
 const modeToggle={x:submit.x-touch-gap,y:submit.y,w:touch,h:touch},toggle={x:modeToggle.x-touch-gap,y:submit.y,w:touch,h:touch};
 const stacked=toggle.x<x+outer;if(stacked){toggle.x=x+outer;modeToggle.x=toggle.x+touch+gap;submit.y+=touch+gap;}
 const card={x,y,w:width,h:submit.y+touch+gap-y};
 const status={x:x+outer,y:submit.y,w:Math.max(0,(stacked?submit.x:toggle.x)-x-outer-gap),h:touch};
 const helper={x:x+outer,y,w:width-outer*2,h:header};
 // In landscape, learning overlays stay on the existing video surface:
 // roughly its lower third is keyboard, with native typing directly above it.
 const belowKeyboard=!base.portrait&&visible&&options.keyboardPlacement==='below';
 const overlayKeyboard=!base.portrait&&visible&&!belowKeyboard;
 const keyboardWidth=base.portrait?width-outer*2:Math.min(belowKeyboard?1220:950,width-outer*2);
 const keyboardRect={x:base.portrait?x+outer:(base.width-keyboardWidth)/2,y:card.y+card.h+gap,w:keyboardWidth,h:Math.max(base.portrait?116:160,116/scale)};
 let playerOffsetY=0,stageHeight=base.height,playerTop:number|undefined;
 const overlayControls=!base.portrait,transportHeight=(base.width*scale>=560?60:116)/scale;
 if(overlayKeyboard){
  keyboardRect.h=Math.max(base.height*.30,116/scale);
  // Tiny/short scenes may scroll to retain usable input and targets. Ordinary
  // landscape scenes keep their original 941 height, so video is not shrunk.
  stageHeight=Math.max(base.height,Math.ceil(160+card.h+keyboardRect.h+transportHeight+gap*3));
  keyboardRect.y=stageHeight-transportHeight-gap-keyboardRect.h;
  const move=keyboardRect.y-gap-card.h-card.y;
  for(const rect of[card,input,submit,status,helper,toggle,modeToggle])rect.y+=move;
  // Preserve a readable right-side inset and keep the complete input below the
  // primary goal. A small surface may extend, without resizing its video.
  const inputFloor=Math.max(base.goal.y+base.goal.h+gap,base.trend.y+base.trend.h+44/scale+gap*2);
  const clearance=Math.max(0,inputFloor-input.y);
  if(clearance){stageHeight=Math.ceil(stageHeight+clearance);keyboardRect.y+=clearance;for(const rect of[card,input,submit,status,helper,toggle,modeToggle])rect.y+=clearance}
  playerTop=stageHeight-transportHeight;
 }else if(overlayControls){
  // Hiding the passive keyboard must not strand the editor's actions and
  // transport below the video. Below uses this exact same upper surface.
  // Reserve only the space needed to move a colliding flow panel above it.
  const primaryBottom=Math.max(base.goal.y+base.goal.h,base.title.y+base.title.h,base.trend.y+base.trend.h);
  const cardFloor=primaryBottom+gap*2+base.metrics.h;
  stageHeight=Math.max(base.height,Math.ceil(cardFloor+card.h+gap+transportHeight));
  playerTop=stageHeight-transportHeight;
  const move=playerTop-gap-card.h-card.y;
  for(const rect of[card,input,submit,status,helper,toggle,modeToggle])rect.y+=move;
  if(belowKeyboard){
   // Only the keyboard leaves the video. No browser window or title bar is
   // created; the recording Canvas includes this same embedded lower region.
   const videoBottom=Number.isFinite(options.mediaBottom)?options.mediaBottom!:base.media.y+base.media.h;
   keyboardRect.y=Math.max(stageHeight,videoBottom)+gap;
   const room=(options.availableHeight??0)/scale-keyboardRect.y-gap;
   keyboardRect.h=Math.max(150/scale,Math.min(260/scale,room));
   stageHeight=Math.ceil(keyboardRect.y+keyboardRect.h+gap);
  }
 }else if(practiceCompact&&base.portrait){
  // Phone one-screen: park transport under Check inside the resolved portrait height.
  // Prefer the OS soft keyboard; an optional in-app keyboard may extend the stage.
  const transportH=Math.max(96/scale,base.player.h||96);
  if(!visible){
   playerTop=Math.min(base.height-transportH,card.y+card.h+gap);
   const overflow=card.y+card.h+gap+transportH-base.height;
   if(overflow>0){
    const lift=Math.min(overflow,Math.max(0,card.y-(base.media.y+base.media.h+gap)));
    for(const rect of[card,input,submit,status,helper,toggle,modeToggle])rect.y-=lift;
    playerTop=card.y+card.h+gap;
   }
   stageHeight=base.height;
   playerOffsetY=0;
  }else{
   const occupiedBottom=keyboardRect.y+keyboardRect.h;
   playerOffsetY=Math.max(0,occupiedBottom+gap-base.player.y);stageHeight=Math.ceil(base.height+playerOffsetY);
   playerTop=stageHeight-transportH;
  }
 }else{
  const occupiedBottom=visible?keyboardRect.y+keyboardRect.h:card.y+card.h;
  playerOffsetY=Math.max(0,occupiedBottom+gap-base.player.y);stageHeight=Math.ceil(base.height+playerOffsetY);
 }
 if(overlayControls){
  // A quiet reference toggle does not need a screen-wide invisible hit box.
  helper.x=Math.max(helper.x,base.goal.x+base.goal.w+gap);helper.w=Math.max(touch,Math.min(input.w*.5,input.x+input.w-helper.x));
 }
 return{card,input,submit,status,helper,toggle,modeToggle,keyboard:visible?keyboardRect:null,fontSize,lineHeight,paddingX,paddingY,stageHeight,playerOffsetY,overlayKeyboard,overlayControls,playerTop,portrait:base.portrait,cssScale:scale};
}
/** All DOM controls and Canvas use this same extended portrait surface. */
export function applyInputCardLayout(base:StudioGeometry,options:InputCardOptions={}){
 const inputCard=inputCardGeometry(base,options),dy=inputCard.playerOffsetY,scale=inputCard.cssScale,railInset=20;
 const shift=(r:Rect):Rect=>({...r,y:r.y+dy});
 const zones={...base.zones,input:inputCard.input,submit:inputCard.submit};
 for(const key of ['play','previous','seek','next','mute'] as const)zones[key]=shift(base.zones[key]);
 let height=inputCard.stageHeight,player=shift(base.player),listeningDock={x:12/scale,y:inputCard.stageHeight-52/scale,w:92/scale,h:44/scale};
 // A landscape row has space for six 44px glyphs plus the seek rail.
 // Narrow/portrait scenes use a separate rail and a bounded six-glyph row.
 const inlinePlayer=!base.portrait&&base.width*scale>=560,compactPlayer=scale<1||base.portrait;
 if(inlinePlayer){
  const top=inputCard.playerTop??player.y,touch=44/scale,y=top+4/scale;
  listeningDock={x:8/scale,y,w:96/scale,h:touch};
  zones.play={x:112/scale,y,w:touch,h:touch};zones.previous={x:164/scale,y,w:touch,h:touch};
  zones.next={x:base.width-104/scale,y,w:touch,h:touch};zones.mute={x:base.width-52/scale,y,w:touch,h:touch};
  zones.seek={x:220/scale,y:top,w:base.width-336/scale,h:60/scale};
  player={x:0,y:top,w:base.width,h:60/scale};height=Math.max(height,Math.ceil(top+player.h));
 }else if(compactPlayer){
  const touch=44/scale,gap=Math.max(2/scale,Math.min(8/scale,(base.width-6*touch)/5)),left=inputCard.input.x,width=inputCard.input.w,top=inputCard.playerTop??player.y;
  zones.seek={x:left,y:top,w:width,h:60/scale};
  const groupWidth=6*touch+5*gap,start=Math.max(0,(base.width-groupWidth)/2),y=top+zones.seek.h+4/scale;listeningDock={x:start,y,w:2*touch+gap,h:touch};
  (['play','previous','next','mute'] as const).forEach((key,index)=>{zones[key]={x:start+(index+2)*(touch+gap),y,w:touch,h:touch}});
  player={x:0,y:top,w:base.width,h:y+touch-top+8/scale};height=Math.max(height,Math.ceil(player.y+player.h));
 }
 const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
 let inset=base.inset,metrics=base.metrics;
 if(inputCard.overlayControls){
  const gap=Math.max(6,5/scale),ceiling=base.trend.y+base.trend.h+gap;
  if(intersects(inset,inputCard.input)||intersects(inset,inputCard.helper)){
   const available=Math.max(44/scale,inputCard.input.y-gap-ceiling),factor=Math.min(1,available/inset.h),w=inset.w*factor,h=inset.h*factor;
   inset={x:inset.x+inset.w-w,y:inputCard.input.y-gap-h,w,h};
   if([base.goal,base.title,base.trend,inputCard.helper].some(rect=>intersects(inset,rect))){
    // A saved inset may have been on the left or in the middle. Fall back to
    // the right-hand lane instead of moving it into a primary HUD or helper.
    const room=base.width-gap-(inputCard.helper.x+inputCard.helper.w+gap),fit=Math.min(1,room/inset.w);
    inset={x:base.width-gap-inset.w*fit,y:inputCard.input.y-gap-inset.h*fit,w:inset.w*fit,h:inset.h*fit};
   }
  }
  if([inputCard.input,inputCard.status,inputCard.helper,inputCard.submit,inputCard.toggle,inputCard.modeToggle].some(rect=>intersects(metrics,rect))){
   if(!inputCard.overlayKeyboard){
    // Hidden and Below share this compact, view-only upper flow position.
    metrics={...metrics,x:Math.max(0,Math.min(metrics.x,base.width-metrics.w)),y:inputCard.card.y-gap-metrics.h};
   }else{
   const keyboard=inputCard.keyboard!,left=metrics.x+metrics.w/2<base.width/2;
   // Keep the existing side where possible. A saved central panel must dock
   // beside the keyboard, never collapse to zero because its old x is unsafe.
   const sideStart=left?gap:keyboard.x+keyboard.w+gap,sideEnd=left?keyboard.x-gap:base.width-gap;
   const x=left?Math.max(sideStart,Math.min(metrics.x,50)):Math.max(sideStart,Math.min(metrics.x,sideEnd-Math.min(metrics.w,sideEnd-sideStart)));
   const factor=Math.min(1,(sideEnd-x)/metrics.w);
   metrics={...metrics,x,y:inputCard.card.y+inputCard.card.h+gap,w:metrics.w*factor,h:metrics.h*factor};
   }
  }
 }
 return{...base,height,inset,metrics,console:inputCard.card,zones,player,inputCard,listeningDock,railInset,seekThumbWidthCss:railInset*2*scale,
  style:(rect:Rect)=>({left:`${rect.x/base.width*100}%`,top:`${rect.y/height*100}%`,width:`${rect.w/base.width*100}%`,height:`${rect.h/height*100}%`}),
  timelineProgress:(clientX:number,left:number,cssWidth:number)=>Math.max(0,Math.min(1,((clientX-left)*base.width/cssWidth-zones.seek.x-railInset)/(zones.seek.w-railInset*2))),
  cueMarker:(ratio:number)=>({x:zones.seek.x+railInset+Math.max(0,Math.min(1,ratio))*(zones.seek.w-railInset*2)-22/scale,y:zones.seek.y+(compactPlayer?16/scale:13),w:44/scale,h:44/scale}),
 };
}

/** Pixel-valued native styles; scale is CSS pixels per logical scene pixel. */
export function inputCardTextareaStyle(card:InputCardGeometry,scale:number){return{
 boxSizing:'border-box' as const,resize:'none' as const,whiteSpace:'pre-wrap' as const,overflowWrap:'break-word' as const,wordBreak:'normal' as const,
 overflowX:'hidden' as const,overflowY:'auto' as const,scrollbarWidth:'none' as const,
 fontFamily:INPUT_FONT,fontSize:`${card.fontSize*scale}px`,lineHeight:`${card.lineHeight*scale}px`,fontWeight:400,
 '--entry-base-padding-x':`${card.paddingX*scale}px`,letterSpacing:'0px',padding:`${card.paddingY*scale}px ${card.paddingX*scale}px`,border:'0',borderRadius:`${8*scale}px`,
 textShadow:'none',color:'#f4f6f5',caretColor:'#d8ffe8',background:'transparent',textAlign:'left' as const,textTransform:'none' as const,
 tabSize:8,direction:'ltr' as const,
};}

interface NativeMirror {mirror:HTMLDivElement;node:Text;baseline:HTMLSpanElement;key:string;lines:NativeInputLine[];baselineOffset:number;scale:number}
const mirrors=new WeakMap<HTMLTextAreaElement,NativeMirror>();
const copiedProperties=['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','fontStretch','fontKerning','fontFeatureSettings','fontVariationSettings','letterSpacing','wordSpacing','lineHeight','textTransform','textIndent','textAlign','direction','tabSize','wordBreak','overflowWrap'] as const;
const numeric=(value:string)=>Number.parseFloat(value)||0;
/** Preserve the used layout width: both clientWidth and CSSOM strings can round. */
export function nativeInputContentWidth(element:HTMLTextAreaElement,css:CSSStyleDeclaration){
 const padding=numeric(css.paddingLeft)+numeric(css.paddingRight),border=numeric(css.borderLeftWidth)+numeric(css.borderRightWidth);
 const width=Number.parseFloat(css.width);
 if(!Number.isFinite(width))return Math.max(1,element.clientWidth-padding);
 // The outer viewport's scrollbar is already reflected in computed width.
 // Subtract only a scrollbar belonging to the textarea itself, if present.
 const ownGutter=css.overflowY==='hidden'||css.overflowY==='clip'||css.scrollbarWidth==='none'?0:Math.max(0,(element.offsetWidth??element.clientWidth)-element.clientWidth-Math.round(border));
 const cssBorderBox=width+(css.boxSizing==='border-box'?0:padding+border),rectWidth=element.getBoundingClientRect?.().width;
 // CSSOM may serialize 264.03125 as 264.031px. Reassigning that string loses
 // another 1/64px layout unit in Blink and can wrap two extra whole lines.
 // Studio sizes in CSS pixels, without transforms. Only refine serialization
 // precision when the rect agrees; a scaled/rotated visual box is not layout.
 // CSSOM uses six significant digits; allow at most half its last digit.
 const serializationUnit=10**(Math.floor(Math.log10(Math.max(1,Math.abs(cssBorderBox))))-5),tolerance=Math.max(.001,serializationUnit/2);
 const borderBox=typeof rectWidth==='number'&&Number.isFinite(rectWidth)&&rectWidth>0&&Math.abs(rectWidth-cssBorderBox)<=tolerance?rectWidth:cssBorderBox;
 return Math.max(1,borderBox-padding-border-ownGutter);
}
/**
 * Capture the browser's own pre-wrap layout without touching selection/focus or
 * mutating the textarea. The hidden mirror has the exact native content box.
 * Runtime callers recapture on input, selection, scroll and geometry changes.
 */
export function captureNativeInputDisplay(element:HTMLTextAreaElement,sceneScale=1):NativeInputDisplay{
 const scale=Number.isFinite(sceneScale)&&sceneScale>0?sceneScale:1;
 const doc=element.ownerDocument,win=doc.defaultView;
 if(!win)throw new Error('A connected textarea document is required for native display capture.');
 const css=win.getComputedStyle(element),text=element.value,cacheMap=mirrors;
 const px=numeric(css.paddingLeft),py=numeric(css.paddingTop),right=numeric(css.paddingRight),bottom=numeric(css.paddingBottom);
 const contentWidth=nativeInputContentWidth(element,css),lineHeight=numeric(css.lineHeight)||numeric(css.fontSize)*1.2;
 let cache=cacheMap.get(element);
 if(!cache){
  const mirror=doc.createElement('div'),node=doc.createTextNode(''),baseline=doc.createElement('span');
  mirror.setAttribute('aria-hidden','true');mirror.setAttribute('translate','no');mirror.className='notranslate';mirror.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;box-sizing:content-box;margin:0;border:0;white-space:pre-wrap;overflow-wrap:break-word;overflow:visible;';
  baseline.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline;';
  mirror.append(node,baseline);doc.body.appendChild(mirror);
  cache={mirror,node,baseline,key:'',lines:[],baselineOffset:0,scale};cacheMap.set(element,cache);
 }
 // Translation or another page helper can split/replace hidden text nodes
 // between frames even when the native textarea and style cache key are stable.
 // Rebuild the complete measurement input; never clamp away draft characters.
 const expectedText=text?text+(text.endsWith('\n')?'\u200b':''):'\u200b';
 const children=cache.mirror.childNodes;
 const changedTree=('parentNode' in cache.node&&cache.node.parentNode!==cache.mirror)||
  (children&&(children.length!==2||children[0]!==cache.node||children[1]!==cache.baseline));
 if(changedTree){cache.mirror.replaceChildren(cache.node,cache.baseline);cache.key=''}
 if(cache.mirror.isConnected===false||('parentNode' in cache.mirror&&cache.mirror.parentNode!==doc.body)){doc.body.appendChild(cache.mirror);cache.key=''}
 if(cache.baseline.textContent||cache.baseline.childNodes?.length){cache.baseline.textContent='';cache.key=''}
 if(cache.node.data!==expectedText){cache.node.data=expectedText;cache.key=''}
 const key=JSON.stringify([text,contentWidth,px,py,right,bottom,scale,...copiedProperties.map(p=>css[p])]);
 if(cache.key!==key){
  for(const property of copiedProperties)cache.mirror.style[property]=css[property];
  cache.mirror.style.width=`${contentWidth}px`;cache.mirror.style.padding=`${py}px ${right}px ${bottom}px ${px}px`;
  const origin=cache.mirror.getBoundingClientRect(),range=doc.createRange(),pieces:{start:number;end:number;text:string;box:DOMRect}[]=[];
  for(const part of visualSegments(cache.node.data)){
   range.setStart(cache.node,part.index);range.setEnd(cache.node,part.index+part.segment.length);
   const rects=Array.from(range.getClientRects()),box=rects.find(r=>r.height>0)??range.getBoundingClientRect();
   pieces.push({start:part.index,end:Math.min(text.length,part.index+part.segment.length),text:part.index<text.length?part.segment:'',box});
  }
  const last=pieces.at(-1),baselineY=cache.baseline.getBoundingClientRect().top;
  const baselineOffset=last?baselineY-last.box.top:lineHeight*.8;
  const lines:NativeInputLine[]=[];let afterTab=false;
  for(const piece of pieces){
   const x=(piece.box.x-origin.x)/scale,y=(piece.box.y-origin.y)/scale,width=piece.box.width/scale,height=piece.box.height/scale;
   const previous=lines.at(-1),segment=piece.text==='\n'?'':piece.text;
   // Canvas does not expand tab characters. Preserve their native geometry by
   // starting a new drawing run after each tab instead of inventing spacing.
   if(piece.text==='\t'){afterTab=true;continue}
   if(previous&&!afterTab&&Math.abs(previous.y-y)<.25/scale&&previous.end===piece.start){previous.end=piece.end;previous.text+=segment;previous.width=Math.max(previous.width,x+width-previous.x)}
   else lines.push({start:piece.start,end:piece.end,text:segment,x,y,width,height,baseline:y+baselineOffset/scale});
   afterTab=false;
  }
  cache.key=key;cache.lines=lines;cache.baselineOffset=baselineOffset;cache.scale=scale;
 }
 const origin=cache.mirror.getBoundingClientRect(),range=doc.createRange();
 const start=Math.max(0,Math.min(text.length,element.selectionStart??0)),end=Math.max(start,Math.min(text.length,element.selectionEnd??start));
 const active=element.selectionDirection==='backward'?start:end;
 range.setStart(cache.node,start);range.setEnd(cache.node,end);
 const selection=start===end?[]:Array.from(range.getClientRects()).filter(r=>r.height>0).map(r=>({x:(r.x-origin.x)/scale,y:(r.y-origin.y)/scale,w:Math.max(r.width/scale,1),h:r.height/scale}));
 range.setStart(cache.node,active);range.collapse(true);let caretBox=range.getClientRects()[0];
 if(!caretBox||caretBox.height===0){
  range.setStart(cache.node,Math.min(active,cache.node.length-1));range.setEnd(cache.node,Math.min(cache.node.length,active+1));caretBox=range.getClientRects()[0];
 }
 const lastLine=cache.lines.at(-1),caret=caretBox?{x:(caretBox.x-origin.x)/scale,y:(caretBox.y-origin.y)/scale,w:1.5,h:caretBox.height/scale}:{x:lastLine?lastLine.x+lastLine.width:px/scale,y:lastLine?.y??py/scale,w:1.5,h:lineHeight/scale};
 // The last drawable run may precede a trailing tab. Read the native end
 // separately from the user's active selection, without changing that selection.
 range.setStart(cache.node,text.length);range.collapse(true);let endBox=range.getClientRects()[0],endAtRight=false;
 if(!endBox||endBox.height===0){
  if(cache.node.length>text.length){range.setStart(cache.node,text.length);range.setEnd(cache.node,text.length+1);endBox=range.getClientRects()[0]}
  else{const part=visualSegments(text).at(-1);range.setStart(cache.node,part?.index??0);range.setEnd(cache.node,text.length||1);endBox=range.getClientRects()[0];endAtRight=!!part}
 }
 const endX=endBox?((endAtRight?endBox.x+endBox.width:endBox.x)-origin.x)/scale:lastLine?lastLine.x+lastLine.width:px/scale;
 const endY=endBox?(endBox.y-origin.y)/scale:lastLine?.y??py/scale;
 const draftEnd={x:endX,y:endY,w:1.5,h:endBox?endBox.height/scale:lineHeight/scale,baseline:endY+cache.baselineOffset/scale};
 const font=`${css.fontStyle||'normal'} ${css.fontWeight||'400'} ${numeric(css.fontSize)/scale}px ${css.fontFamily}`;
 return{text,lines:cache.lines.map(line=>({...line})),selection,caret,draftEnd,scrollLeft:element.scrollLeft/scale,scrollTop:element.scrollTop/scale,width:(contentWidth+px+right)/scale,height:element.clientHeight/scale,font,letterSpacing:numeric(css.letterSpacing)/scale,lineHeight:lineHeight/scale,paddingX:px/scale,paddingY:py/scale};
}
/** Call when the input unmounts; no long-lived draft or keystroke storage. */
export function releaseNativeInputDisplay(element:HTMLTextAreaElement){for(const map of[mirrors]){map.get(element)?.mirror.remove();map.delete(element)}}

export interface KeyboardKey {code:string;label:string;rect:Rect}
const KEY_ROWS:readonly (readonly (readonly [string,string,number])[])[]=[
 [['Backquote','`',1],['Digit1','1',1],['Digit2','2',1],['Digit3','3',1],['Digit4','4',1],['Digit5','5',1],['Digit6','6',1],['Digit7','7',1],['Digit8','8',1],['Digit9','9',1],['Digit0','0',1],['Minus','-',1],['Equal','=',1],['Backspace','Bksp',1.65]],
 [['Tab','Tab',1.35],...Array.from('QWERTYUIOP',letter=>[`Key${letter}`,letter,1] as const),['BracketLeft','[',1],['BracketRight',']',1],['Backslash','\\',1.3]],
 [['CapsLock','Caps',1.65],...Array.from('ASDFGHJKL',letter=>[`Key${letter}`,letter,1] as const),['Semicolon',';',1],['Quote',"'",1],['Enter','Enter',2]],
 [['ShiftLeft','Shift',2.15],...Array.from('ZXCVBNM',letter=>[`Key${letter}`,letter,1] as const),['Comma',',',1],['Period','.',1],['Slash','/',1],['ShiftRight','Shift',2.5]],
 [['ControlLeft','Ctrl',1.5],['AltLeft','Alt',1.5],['MetaLeft','⌘',1.5],['Space','Space',6.15],['ArrowLeft','←',1],['ArrowUp','↑',1],['ArrowDown','↓',1],['ArrowRight','→',1]],
];
/** Passive visuals only. These are never input buttons or focus targets. */
export function keyboardKeyRects(rect:Rect):KeyboardKey[]{
 const pad=7,gap=3,rowHeight=(rect.h-pad*2-gap*4)/5;
 return KEY_ROWS.flatMap((row,index)=>{
  const units=row.reduce((total,key)=>total+key[2],0),unit=(rect.w-pad*2-gap*(row.length-1))/units;let x=rect.x+pad;
  return row.map(([code,label,size])=>{const key={code,label,rect:{x,y:rect.y+pad+index*(rowHeight+gap),w:unit*size,h:rowHeight}};x+=key.rect.w+gap;return key});
 });
}
export function paintPassiveKeyboard(c:CanvasRenderingContext2D,card:InputCardGeometry,state:KeyboardFeedback|undefined,now:number,reducedMotion:boolean){
 const rect=card.keyboard;if(!rect||state?.visible===false)return;
 const pressed=new Set(state?.codes??[]),committed=!reducedMotion&&!!state&&state.committedUntil>now;
 c.save();c.beginPath();c.roundRect(rect.x,rect.y,rect.w,rect.h,10);c.fillStyle='#edf5f00a';c.fill();
 c.strokeStyle=state?.composing?'#c7daef99':committed?'#b8e7bfaa':'#d7e9df38';c.lineWidth=1;c.stroke();
 for(const key of keyboardKeyRects(rect)){
  const active=pressed.has(key.code),r=key.rect,dy=active&&!reducedMotion?1.3:0;
  c.beginPath();c.roundRect(r.x,r.y+dy,r.w,r.h,3);c.fillStyle=active?'#cce6bdc9':'#e6f0e50d';c.fill();
  c.strokeStyle=active?'#ecf8e5':'#d6e5e231';c.lineWidth=.7;c.stroke();
  c.font=`400 ${Math.max(10/card.cssScale,Math.min(12.5/card.cssScale,r.h*.52))}px ${STUDIO_SANS}`;c.letterSpacing='0px';c.textAlign='center';c.textBaseline='middle';c.fillStyle=active?'#16241b':'#ecf2ed';
  c.fillText(key.label,r.x+r.w/2,r.y+dy+r.h/2+.5);
 }
 c.restore();
}

export function visualSegments(value:string):{segment:string;index:number}[]{
 if(typeof Intl.Segmenter==='function')return Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value),({segment,index})=>({segment,index}));
 let index=0;return Array.from(value,segment=>{const part={segment,index};index+=segment.length;return part});
}

/** SSR/replay fallback only. Live editing uses captureNativeInputDisplay. */
export function wrapInputText(text:string,maxWidth:number,measure:(text:string)=>number):{text:string;start:number;end:number}[]{
 const result:{text:string;start:number;end:number}[]=[];let start=0;
 for(const paragraph of text.split('\n')){
  const graphemes=visualSegments(paragraph);let from=0;
  while(from<graphemes.length){
   let to=from,lastBreak=-1;
   while(to<graphemes.length){
    const part=graphemes[to],end=part.index+part.segment.length;
    if(to>from&&measure(paragraph.slice(graphemes[from].index,end))>maxWidth)break;
    if(/\s/.test(part.segment))lastBreak=to+1;
    to++;
   }
   if(to<graphemes.length&&lastBreak>from)to=lastBreak;
   const begin=graphemes[from].index,end=graphemes[to-1].index+graphemes[to-1].segment.length;
   result.push({text:paragraph.slice(begin,end),start:start+begin,end:start+end});from=to;
  }
  if(!paragraph)result.push({text:'',start,end:start});
  start+=paragraph.length+1;
 }
 return result;
}
export type InputUnderlineMode='letters'|'words';
export interface InputGuide {mode:InputUnderlineMode; mask:string}
/** No expected letters survive this explicit, assisted presentation projection. */
export function inputGuideMask(reference:string){return visualSegments(reference).map(part=>/\s/u.test(part.segment)?part.segment:'_').join('')}
export function inputGuideSummary(mask:string,locale:StudioLocale='en'){return translate(locale,'scene.guideSummary',{letters:Array.from(mask).filter(char=>!/^\s$/u.test(char)).length,words:mask.match(/\S+/gu)?.length??0})}
export function defaultKeyboardVisible(mobile:boolean,portrait:boolean,stored:string|null){return !mobile&&!portrait&&stored!=='0'}

export function paintInputText(c:CanvasRenderingContext2D,card:InputCardGeometry,state:{draft:string;typingErrorAt?:number;recording?:boolean;checkedAttempt?:Attempt|null;referenceGuide?:string;underlineMode?:InputUnderlineMode;inputGuide?:InputGuide;nativeInputDisplay?:NativeInputDisplay;scrollLeft:number;scrollTop?:number;caret:number;selectionEnd:number;inputFocused:boolean;composition:boolean;reducedMotion:boolean;renderTime:number}){
 const z=card.input,native=state.nativeInputDisplay?.text===state.draft?state.nativeInputDisplay:undefined;
 c.save();c.beginPath();c.roundRect(z.x,z.y,z.w,z.h,8);c.clip();
 // Match the native viewport's inner clip: padding must not reveal fragments
 // of a fourth line. Neither drawing nor recording rewraps the current page.
 if(native?.window){c.beginPath();c.rect(z.x,z.y+native.window.clipTop,z.w,native.window.clipBottom-native.window.clipTop);c.clip()}
 c.font=native?.font??`400 ${card.fontSize}px ${INPUT_FONT}`;c.letterSpacing=`${native?.letterSpacing??0}px`;c.textBaseline='alphabetic';c.textAlign='left';
 const scrollX=native?.scrollLeft??state.scrollLeft,scrollY=native?.scrollTop??state.scrollTop??0;
 let lines=native?.lines;
 if(!lines){
  const centeredPadding=centeredInputPadding(z.w*card.cssScale,card.paddingX*card.cssScale,state.referenceGuide,text=>c.measureText(text).width*card.cssScale)/card.cssScale;
  const metrics=c.measureText('Mg'),asc=metrics.fontBoundingBoxAscent||metrics.actualBoundingBoxAscent,desc=metrics.fontBoundingBoxDescent||metrics.actualBoundingBoxDescent,baseline=(card.lineHeight-asc-desc)/2+asc;
  lines=wrapInputText(state.draft,z.w-centeredPadding*2,text=>c.measureText(text).width).map((line,index)=>({...line,x:centeredPadding,y:card.paddingY+index*card.lineHeight,width:c.measureText(line.text).width,height:card.lineHeight,baseline:card.paddingY+index*card.lineHeight+baseline}));
 }
 const guideText=state.referenceGuide?referenceGuideText(state.draft,state.referenceGuide):undefined;
 if(guideText){
  const guideLines=native?.reference?.text===guideText?native.reference.lines:layoutReferenceRemainder(state.draft,state.referenceGuide!,{lines,draftEnd:native?.draftEnd,width:z.w,paddingX:native?.paddingX??lines[0]?.x??card.paddingX,paddingY:card.paddingY,lineHeight:card.lineHeight},text=>c.measureText(text).width);
  c.fillStyle='#b7c6c1';c.globalAlpha=.76;for(const run of guideLines){if(run.y+run.height<scrollY||run.y>scrollY+z.h)continue;c.fillText(run.text,z.x+run.x-scrollX,z.y+run.baseline-scrollY)}c.globalAlpha=1;
 }
 const rangeStart=Math.min(state.caret,state.selectionEnd),rangeEnd=Math.max(state.caret,state.selectionEnd);
 const selection=native?.selection??lines.flatMap(line=>{const begin=Math.max(line.start,rangeStart),end=Math.min(line.end,rangeEnd);if(begin>=end)return[];return[{x:line.x+c.measureText(line.text.slice(0,begin-line.start)).width,y:line.y,w:c.measureText(line.text.slice(begin-line.start,end-line.start)).width,h:line.height}]});
 if(state.inputFocused&&rangeStart!==rangeEnd){c.fillStyle='#8bd2df66';for(const r of selection)c.fillRect(z.x+r.x-scrollX,z.y+r.y-scrollY,r.w,r.h)}
 // Underlines are visual only; never rewrite or split the native editing value.
 const guide=state.inputGuide;
 const guidePadding=native?.paddingX??lines[0]?.x??card.paddingX;
 const underlineLines=guide?wrapInputText(guide.mask,(native?.width??z.w)-guidePadding*2,text=>c.measureText(text).width).map((line,index)=>({...line,x:guidePadding,baseline:(lines[0]?.baseline??card.paddingY+card.lineHeight*.8)+index*card.lineHeight})):lines;
 c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetY=0;c.strokeStyle=guide?'#e4f6bfee':'#e4f6d9e6';c.lineWidth=Math.max(1,1/card.cssScale);
 for(const line of underlineLines){const mode=guide?.mode??state.underlineMode??'letters';const runs=mode==='words'?Array.from(line.text.matchAll(/\S+/gu),match=>({segment:match[0],index:match.index!})):visualSegments(line.text).filter(part=>!/^\s+$/u.test(part.segment));for(const part of runs){const left=c.measureText(line.text.slice(0,part.index)).width,width=c.measureText(part.segment).width,gap=mode==='letters'?Math.min(3,width*.16):0;c.beginPath();c.moveTo(z.x+line.x+left+gap-scrollX,z.y+line.baseline+4-scrollY);c.lineTo(z.x+line.x+left+width-gap-scrollX,z.y+line.baseline+4-scrollY);c.stroke()}}
 const {ranges:feedbackRanges}=inputLetterFeedback(state.draft,state.referenceGuide,state.checkedAttempt??null,state.composition);
 for(const run of lines){if(run.y+run.height<scrollY||run.y>scrollY+z.h)continue;
  const boundaries=[0,run.text.length,...feedbackRanges.flatMap(r=>[Math.max(0,Math.min(run.text.length,r.start-run.start)),Math.max(0,Math.min(run.text.length,r.end-run.start))])].sort((a,b)=>a-b);
  for(let i=1;i<boundaries.length;i++){const start=boundaries[i-1],end=boundaries[i];if(start===end)continue;const kind=feedbackRanges.find(r=>run.start+start<r.end&&run.start+end>r.start)?.kind,wrong=kind==='wrong',correct=kind==='correct',x=z.x+run.x+c.measureText(run.text.slice(0,start)).width-scrollX+(wrong?typingErrorShakeOffset(state.renderTime,state.typingErrorAt,state.reducedMotion,state.recording)/card.cssScale:0),y=z.y+run.baseline-scrollY,part=run.text.slice(start,end);c.fillStyle=wrong?'#ff858b':correct?'#8ff0bd':'#f4f6f5';c.fillText(part,x,y);if(correct){c.strokeStyle='#8ff0bd';c.lineWidth=Math.max(1.5,1.5/card.cssScale);c.beginPath();c.moveTo(x,y+4);c.lineTo(x+c.measureText(part).width,y+4);c.stroke()}if(wrong){const width=c.measureText(part).width;c.strokeStyle='#ff858b';c.lineWidth=Math.max(1.5,1.5/card.cssScale);c.beginPath();for(let px=0;px<=width;px+=2/card.cssScale){const yy=y+6/card.cssScale+Math.sin(px*card.cssScale*Math.PI/4)/card.cssScale;if(px===0)c.moveTo(x+px,yy);else c.lineTo(x+px,yy)}c.stroke()}}
 }
 // Native capture omits tab glyphs and can include a newline in run.end.
 // Mark a wrong real control-character gap without inserting content or lines.
 for(let index=0;index<lines.length;index++){
  const run=lines[index],end=run.start+run.text.length,next=lines[index+1],gapEnd=next?.start??state.draft.length;
  if(!/[\t\n]/u.test(state.draft.slice(end,gapEnd))||!feedbackRanges.some(r=>r.kind==='wrong'&&r.start<gapEnd&&r.end>end)||run.y+run.height<scrollY||run.y>scrollY+z.h)continue;
  const textEnd=run.x+c.measureText(run.text).width,minWidth=Math.max(8/card.cssScale,c.measureText('M').width*.5),width=next&&Math.abs(next.y-run.y)<.25?Math.max(minWidth,next.x-textEnd):minWidth;
  const x=Math.min(z.x+textEnd-scrollX,z.x+z.w-card.paddingX-minWidth),y=z.y+run.baseline-scrollY;
  c.strokeStyle='#ff858b';c.lineWidth=Math.max(1.5,1.5/card.cssScale);c.beginPath();for(let px=0;px<=width;px+=2/card.cssScale){const yy=y+6/card.cssScale+Math.sin(px*card.cssScale*Math.PI/4)/card.cssScale;if(px===0)c.moveTo(x+px,yy);else c.lineTo(x+px,yy)}c.stroke();
 }
 if(!state.draft&&!guide&&!state.referenceGuide){c.fillStyle='#e3e9e2aa';const x=z.x+(lines[0]?.x??card.paddingX),y=z.y+(lines[0]?.baseline??card.paddingY+card.lineHeight*.8)+4;c.strokeStyle='#e4f6d98c';c.lineWidth=Math.max(1,1/card.cssScale);c.beginPath();c.moveTo(x,y);c.lineTo(x+Math.min(72,z.w-card.paddingX*2),y);c.stroke()}
 if(state.inputFocused&&rangeStart===rangeEnd&&(state.reducedMotion||state.composition||Math.floor(state.renderTime/550)%2===0)){
  const line=lines.find((line,index)=>state.caret>=line.start&&(state.caret<line.end||index===lines.length-1))??lines.at(-1);
  const caret=native?.caret??{x:line?line.x+c.measureText(line.text.slice(0,state.caret-line.start)).width:card.paddingX,y:line?.y??card.paddingY,w:1.5,h:card.lineHeight};
  c.fillStyle='#d8ffe8';c.fillRect(z.x+caret.x-scrollX,z.y+caret.y-scrollY,caret.w,caret.h);
 }
 c.restore();
}

/** Only call with getDraftFeedback's exact-draft, explicitly submitted attempt. */
export function inputFeedbackLines(attempt:Attempt,locale:StudioLocale='en'):string[]{
 const first=attempt.alignment.find(token=>token.kind!=='match');
 const detail=!first?translate(locale,'hud.correct'):first.kind==='replace'?`${translate(locale,'hud.wrong')}: ${first.actual} → ${first.expected}`:first.kind==='missing'?`${translate(locale,'hud.missing')}: ${first.expected}`:`${translate(locale,'hud.extra')}: ${first.actual}`;
 return[`${translate(locale,'hud.errorCount',{count:attempt.errors})} ›`,detail];
}

/** Font-family CSS strings stay unchanged when a downloadable font replaces fallback. */
export function invalidateNativeInputDisplay(element:HTMLTextAreaElement){for(const map of[mirrors]){const cache=map.get(element);if(cache)cache.key=''}}

/** A bounded viewport scrolls the complete native editor and optional masked guide together. */
export function inputViewportPlan(display:NativeInputDisplay,viewportHeight:number,guideHeight:number,scrollTop:number,revealCaret:boolean){
 const textBottom=Math.max(display.lineHeight+display.paddingY,...display.lines.map(line=>line.y+line.height));
 const contentHeight=Math.ceil(Math.max(viewportHeight,textBottom+display.paddingY,guideHeight));
 let top=Math.max(0,Math.min(scrollTop,contentHeight-viewportHeight));
 if(revealCaret){if(display.caret.y<top)top=display.caret.y;else if(display.caret.y+display.caret.h>top+viewportHeight)top=display.caret.y+display.caret.h-viewportHeight;top=Math.max(0,Math.min(top,contentHeight-viewportHeight))}
 return{contentHeight,scrollTop:top,viewportHeight};
}
/**
 * A portrait page follows the measured native caret, never reference length or
 * an arbitrary phrase split. Backspace, selection direction and IME therefore
 * use the very same rows as the untouched, complete textarea. Last pages retain
 * blank slots so browser scroll clamping cannot expose clipped preceding rows.
 */
export function portraitInputViewportPlan(display:NativeInputDisplay,viewportHeight:number,guideHeight=0){
 const lineHeight=Math.max(1,display.lineHeight),padding=Math.max(0,display.paddingY);
 const lineCount=Math.max(1,Math.min(3,Math.floor((viewportHeight-padding*2+lineHeight*.001)/lineHeight)));
 const origin=display.lines[0]?.y??padding,activeLine=Math.max(0,Math.round((display.caret.y-origin)/lineHeight));
 const firstLine=Math.floor(activeLine/lineCount)*lineCount,scrollTop=firstLine*lineHeight;
 const contentHeight=Math.ceil(Math.max(viewportHeight,scrollTop+viewportHeight,guideHeight,...display.lines.map(line=>line.y+line.height+padding)));
 return{contentHeight,scrollTop,viewportHeight,window:{firstLine,lineCount,clipTop:padding,clipBottom:padding+lineCount*lineHeight}};
}
const viewportMeasures=new WeakMap<HTMLTextAreaElement,CanvasRenderingContext2D>();
/** Stable whole-cue block; hidden geometry never takes a reference argument. */
export function centeredInputPadding(width:number,basePadding:number,reference:string|undefined,measure:(text:string)=>number){
 const inner=Math.max(1,width-basePadding*2),content=reference===undefined?inner:Math.min(inner,Math.max(72,...reference.split('\n').map(line=>measure(line))));
 return Math.max(basePadding,(width-content)/2);
}
function centerNativeInput(element:HTMLTextAreaElement,viewport:HTMLDivElement,reference?:string){
 const css=element.ownerDocument.defaultView!.getComputedStyle(element);let context=viewportMeasures.get(element);
 if(!context){context=element.ownerDocument.createElement('canvas').getContext('2d')??undefined;if(context)viewportMeasures.set(element,context)}if(!context)return;
 context.font=`${css.fontStyle||'normal'} ${css.fontWeight||'400'} ${css.fontSize} ${css.fontFamily}`;context.letterSpacing=css.letterSpacing;
 const base=numeric(css.getPropertyValue('--entry-base-padding-x'))||8,padding=centeredInputPadding(nativeInputContentWidth(element,css)+numeric(css.paddingLeft)+numeric(css.paddingRight),base,reference,text=>context!.measureText(text).width+context!.measureText('M').width*.3);
 const value=`${padding}px`;if(element.style.paddingLeft!==value)element.style.paddingLeft=value;if(element.style.paddingRight!==value)element.style.paddingRight=value;
}
/** Canvas paints live/checked colors; native caret, selection and IME stay authoritative. */
export function syncNativeFeedback(element:HTMLTextAreaElement,attempt:Attempt|null,visibleReference?:string,composing=false){
 const feedback=inputLetterFeedback(element.value,visibleReference,attempt,composing),colored=feedback.ranges.length>0,color=colored?'transparent':'#f4f6f5';
 if(element.style.webkitTextFillColor!==color)element.style.webkitTextFillColor=color;if(element.style.color!==color)element.style.color=color;
 element.dataset.checkedErrors=String(feedback.mode==='checked'&&colored);element.dataset.letterFeedback=feedback.mode;
 element.setAttribute?.('aria-invalid',String(feedback.mode==='checked'?!!attempt&&attempt.errors>0:feedback.mode==='live'&&feedback.ranges.some(range=>range.kind==='wrong')));
}

/** Never changes value, selection or focus. Native editing/IME remains one textarea. */
export function syncInputViewport(element:HTMLTextAreaElement,viewport:HTMLDivElement,guide:InputGuide|undefined,scale=1,revealCaret=false,reference?:string,portraitWindow=false):NativeInputDisplay{
 const win=element.ownerDocument.defaultView;
 if(win)centerNativeInput(element,viewport,reference);
 let display=captureNativeInputDisplay(element,scale);
 // clientHeight rounds CSS pixels. A fractional 3-line portrait allocation
 // must not silently become 2 lines. Ignore materially transformed bounds.
 const rectHeight=portraitWindow?viewport.getBoundingClientRect?.().height:undefined;
 const usedHeight=typeof rectHeight==='number'&&Number.isFinite(rectHeight)&&rectHeight>0&&Math.abs(rectHeight-viewport.clientHeight)<=.51?rectHeight:viewport.clientHeight;
 const height=usedHeight/scale,requestedScroll=viewport.scrollTop/scale+element.scrollTop/scale;
 let referenceDisplay:NativeInputDisplay['reference'],plan=inputViewportPlan(display,height,0,requestedScroll,revealCaret);
 // Growing the textarea can add the outer scrollbar and narrow its content box.
 // Settle that width before returning a frame; never keep the pre-growth wraps.
 const project=()=>{
  let guideHeight=0;referenceDisplay=undefined;
  if(guide||reference){let context=viewportMeasures.get(element);if(!context){context=element.ownerDocument.createElement('canvas').getContext('2d')??undefined;if(context)viewportMeasures.set(element,context)}
   if(context){context.font=display.font;context.letterSpacing=`${display.letterSpacing}px`;
    if(reference){const lines=layoutReferenceRemainder(element.value,reference,display,text=>context!.measureText(text).width);referenceDisplay={text:referenceGuideText(element.value,reference),lines};guideHeight=Math.max(0,...lines.map(line=>line.y+line.height))+display.paddingY}
    if(guide){const lines=wrapInputText(guide.mask,display.width-display.paddingX*2,text=>context!.measureText(text).width);guideHeight=Math.max(guideHeight,lines.length*display.lineHeight+display.paddingY*2)}
   }
  }
  plan=portraitWindow?portraitInputViewportPlan(display,height,guideHeight):inputViewportPlan(display,height,guideHeight,requestedScroll,revealCaret);
  const cssHeight=plan.contentHeight*scale;if(Math.abs((Number.parseFloat(element.style.height)||0)-cssHeight)>.001)element.style.height=`${cssHeight}px`;
 };
 for(let pass=0;pass<3;pass++){
  project();if(!win)break;
  const css=win.getComputedStyle(element),width=nativeInputContentWidth(element,css)+numeric(css.paddingLeft)+numeric(css.paddingRight);
  if(Math.abs(width-display.width*scale)<.0001)break;
  centerNativeInput(element,viewport,reference);display=captureNativeInputDisplay(element,scale);
  // Even if layout keeps changing at the bound, plan and guide must belong
  // to the final captured snapshot rather than the previous pass.
  if(pass===2)project();
 }
 // Browser caret auto-scroll can briefly land in the textarea before it grows.
 // Move that offset to the single outer viewport, preserving the visible window.
 if(element.scrollTop)element.scrollTop=0;
 if(portraitWindow){if(element.scrollLeft)element.scrollLeft=0;if(viewport.scrollLeft)viewport.scrollLeft=0}
 if(Math.abs(viewport.scrollTop-plan.scrollTop*scale)>.25)viewport.scrollTop=plan.scrollTop*scale;
 return{...display,reference:referenceDisplay,height,scrollTop:viewport.scrollTop/scale,scrollLeft:viewport.scrollLeft/scale,...(portraitWindow?{window:portraitInputViewportPlan(display,height).window}:{})};
}
