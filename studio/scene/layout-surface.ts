import type {Rect} from './transparent-layout';
/** Display projection only: saved layout coordinates and constraints remain unchanged. */
export function layoutSurfaceStyle(rect:Rect,width:number,height:number){return{left:`${rect.x/width*100}%`,top:`${rect.y/height*100}%`,width:`${rect.w/width*100}%`,height:`${rect.h/height*100}%`}}
export function layoutSurfaceDelta(dx:number,dy:number,cssWidth:number,cssHeight:number,width:number,height:number){return{dx:dx*width/Math.max(1,cssWidth),dy:dy*height/Math.max(1,cssHeight)}}
