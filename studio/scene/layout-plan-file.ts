import {parseResponsiveArrangement} from './responsive-editor';
import type {Arrangement,Movable,Rect} from './transparent-layout';
import type {LayoutConfiguration,LayoutContext} from './layout-transactions';
export const LAYOUT_PLAN_VERSION='lingotrace-stage-layout-v1';
export const MAX_LAYOUT_PLAN_BYTES=65536;
const items=['media','inset','subtitle','metrics'] as const;
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('布局文件必须使用普通 JSON 对象。');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Object.values(descriptors).some(d=>!('value'in d)))throw Error('布局文件不能含访问器。');
 return value as Record<string,unknown>;
}
function keys(value:Record<string,unknown>,allowed:readonly string[],required=allowed){
 if(Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))throw Error('布局文件含未知或缺失字段。');
}
function noDuplicateKeys(text:string){
 const stack:{object:boolean;expectKey:boolean;keys:Set<string>}[]=[];
 const tokens=text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)??[];
 for(const token of tokens){const top=stack.at(-1);
  if(token==='{'){stack.push({object:true,expectKey:true,keys:new Set()});continue}
  if(token==='['){stack.push({object:false,expectKey:false,keys:new Set()});continue}
  if(token==='}'||token===']'){stack.pop();continue}
  if(token===','&&top?.object){top.expectKey=true;continue}
  if(token.startsWith('"')&&top?.object&&top.expectKey){const key=JSON.parse(token);if(top.keys.has(key)||['__proto__','prototype','constructor'].includes(key))throw Error('布局文件含重复或不安全字段。');top.keys.add(key);top.expectKey=false}
 }
}
export function validateLayoutPlan(value:unknown,context:LayoutContext):LayoutConfiguration{
 const root=object(value);keys(root,['schemaVersion','orientation','canvas','configuration']);
 if(root.schemaVersion!==LAYOUT_PLAN_VERSION)throw Error('布局文件版本不受支持。');
 if(root.orientation!==(context.portrait?'portrait':'landscape'))throw Error('布局方向不匹配，请先切到文件对应方向；不会自动转换。');
 const canvas=object(root.canvas);keys(canvas,['width','height']);
 if(canvas.width!==(context.portrait?430:1672)||canvas.height!==(context.portrait?context.height:941))throw Error('布局基准画布不匹配；不会自动缩放或迁移。');
 const config=object(root.configuration);keys(config,['layout','arrangement']);
 if(!['lesson','camera','split'].includes(config.layout as string))throw Error('不支持的舞台主次模式。');
 const raw=object(config.arrangement);keys(raw,items,[]);const arrangement:Arrangement={};
 for(const key of items){if(!Object.hasOwn(raw,key))continue;const rect=object(raw[key]);keys(rect,['x','y','w','h']);
  for(const n of Object.values(rect))if(typeof n!=='number'||!Number.isFinite(n))throw Error('布局坐标必须是有限数值。');
  if((rect.x as number)<0||(rect.y as number)<0)throw Error('布局坐标不能为负数。');
  if((rect.w as number)<=0||(rect.h as number)<=0||!Number.isFinite((rect.w as number)/(rect.h as number))||(rect.w as number)/(rect.h as number)<=0)throw Error('布局尺寸必须大于零。');
  arrangement[key]={x:rect.x as number,y:rect.y as number,w:rect.w as number,h:rect.h as number};
 }
 const normalized=parseResponsiveArrangement(arrangement,context.portrait,context.height);
 for(const key of Object.keys(arrangement)as Movable[])for(const field of ['x','y','w','h']as const){
  if(!Number.isFinite(normalized[key]![field])||((field==='w'||field==='h')&&normalized[key]![field]<=0)||Math.abs(arrangement[key]![field]-normalized[key]![field])>((field==='w'||field==='h')?Math.min(1e-8,Math.abs(arrangement[key]![field])*1e-8):1e-8))throw Error('布局坐标超出当前安全区或尺寸范围。');
 }
 return{layout:config.layout as LayoutConfiguration['layout'],arrangement};
}
export function parseLayoutPlan(text:string,context:LayoutContext):LayoutConfiguration{
 if(new TextEncoder().encode(text).byteLength>MAX_LAYOUT_PLAN_BYTES)throw Error('布局文件不能超过 64 KiB。');
 let raw:unknown;try{raw=JSON.parse(text)}catch{throw Error('布局文件不是有效 JSON。')}
 noDuplicateKeys(text);return validateLayoutPlan(raw,context);
}
export function exportLayoutPlan(config:LayoutConfiguration,context:LayoutContext):string{
 const raw={schemaVersion:LAYOUT_PLAN_VERSION,orientation:context.portrait?'portrait':'landscape',canvas:{width:context.portrait?430:1672,height:context.portrait?context.height:941},configuration:config};
 const safe=validateLayoutPlan(raw,context);return JSON.stringify({...raw,configuration:safe},null,2)+'\n';
}
export function layoutPlanChanges(before:LayoutConfiguration,after:LayoutConfiguration):string[]{
 const changes:string[]=[];if(before.layout!==after.layout)changes.push('舞台主次');
 const names:Record<Movable,string>={media:'主画面',inset:'小窗',subtitle:'字幕',metrics:'输入节奏'};
 for(const key of items){const a=before.arrangement[key],b=after.arrangement[key];if(!a&&!b)continue;
  if(!a||!b||(['x','y','w','h']as const).some(field=>(a as Rect)[field]!==b[field]))changes.push(names[key]);
 }return changes;
}
