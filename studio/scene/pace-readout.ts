export type MeasureReadout=(value:string,size:number,weight:number,tracking:number)=>number;
export interface ReadoutText{value:string;x:number;y:number;size:number;weight:number;width:number}
/** Measures the real font. Two digits retain the reference geometry; longer values reflow. */
export function layoutPaceReadout(pace:number,measure:MeasureReadout){
 const value=String(pace),left=44,right=321,baseSize=89.75;
 const natural=measure(value,baseSize,600,2);
 // Fit only when the number itself exceeds its column. Never clamp or abbreviate the value.
 const size=natural>right-left?baseSize*(right-left)/natural:baseSize;
 const number:ReadoutText={value,x:left,y:843,size,weight:600,width:measure(value,size,600,2)};
 const unitValue='CHARS / MIN',unitWidth=measure(unitValue,17,400,1);
 const besideX=Math.max(174,left+number.width+14),beside=besideX+unitWidth<=right;
 const unit:ReadoutText={value:unitValue,x:beside?besideX:left,y:beside?816:864,size:17,weight:400,width:unitWidth};
 return{number,unit,mode:beside?'beside':'below'}as const;
}
