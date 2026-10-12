import type {Rect} from './transparent-layout';

type CameraGeometry={width:number;height:number;inset:Rect;console:Rect;title:Rect;trend?:Rect;inputCard?:{input:Rect;helper:Rect;overlayKeyboard?:boolean;overlayControls?:boolean}};
type CameraState='off'|'requesting'|'on'|'error';
export interface CameraViewport {width:number;height:number}
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
/** View-only geometry: never writes the saved enabled camera arrangement. */
export function cameraControlGeometry(g:CameraGeometry,camera:CameraState,layout:'lesson'|'camera'|'split',
 options:{fixture?:boolean;cssWidth?:number;cssHeight?:number}={}){
 const compact=!options.fixture&&layout==='lesson'&&camera!=='on';
 if(!compact)return{compact,visual:{...g.inset},hit:{...g.inset}};
 const cssWidth=typeof options.cssWidth==='number'&&Number.isFinite(options.cssWidth)&&options.cssWidth>0?options.cssWidth:g.width;
 const cssHeight=typeof options.cssHeight==='number'&&Number.isFinite(options.cssHeight)&&options.cssHeight>0?options.cssHeight:g.height;
 const sx=cssWidth/g.width,sy=cssHeight/g.height;
 const hitW=44/sx,hitH=44/sy,visualW=32/sx,visualH=32/sy;
 // Keep the old inset's upper-right anchor when space allows, without leaving
 // an invisible large hit box or expanding across title/input controls.
 const inside=!!g.inputCard?.overlayControls&&!!g.trend;
 // The enlarged editor's helper is no longer a full-width invisible target.
 // Use the actual clear right lane instead of lifting the icon over the trend.
 const left=inside?g.inputCard!.helper.x+g.inputCard!.helper.w+5/sx:0;
 const cx=clamp(g.inset.x+g.inset.w-visualW/2,Math.max(hitW/2,left+hitW/2),g.width-hitW/2);
 const top=Math.max(0,g.title.y+g.title.h+8/sy,inside?g.trend!.y+g.trend!.h+5/sy:0),bottom=Math.min(g.height,inside?g.inputCard!.input.y-5/sy:g.console.y-8/sy);
 const cy=clamp(g.inset.y+visualH/2,top+hitH/2,Math.max(top+hitH/2,bottom-hitH/2));
 return{compact,visual:{x:cx-visualW/2,y:cy-visualH/2,w:visualW,h:visualH},
  hit:{x:cx-hitW/2,y:cy-hitH/2,w:hitW,h:hitH}};
}
