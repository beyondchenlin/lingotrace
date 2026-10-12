import type { HudMetric, HudScene, HudNode, HudStyle } from '../schema.ts';
import { HUD_REGISTRY } from '../registry.ts';
import { fixtureScene } from './fixtures.ts';
import { batch2FixtureScene } from './batch2-fixtures.ts';
import { presentationOptions, pulseVisualizationForVariant, variantToNodeType, type HudVariantId } from '../presentation.ts';
export type LabDatasetId='series'|'progress'|'number'|'input'|'groups'|'target'|'calendar';
export type LabDataState='normal'|'no-data'|'missing'|'paused'|'error';
export const LAB_CLOCK={nowMs:30000,reducedMotion:false} as const;
export const LAB_DATASETS=Object.freeze([
  {id:'series',label:'输入量时间序列',defaultVariant:'trend-line',description:'固定的带时间戳字素量观测；折线和时间柱使用完全相同的点与单位。'},
  {id:'progress',label:'明确分子 / 分母',defaultVariant:'progress-ring',description:'同一份 18 / 24 计数；圆环和横向进度条只改变外形。'},
  {id:'number',label:'单个已提供数字',defaultVariant:'numeric',description:'独立数量没有分母，不转换成完成率。'},
  {id:'input',label:'输入事件节奏',defaultVariant:'pulse-wave',description:'固定演示输入事件，不是真实音频、心电或生理心率。'},
  {id:'groups',label:'逐句练习时长',defaultVariant:'bar-chart',description:'按句分组的秒数，含完整零值、未知与部分覆盖。'},
  {id:'target',label:'实际值与目标区间',defaultVariant:'target-band',description:'实际 67、目标 20–50；超范围保留实际数字。'},
  {id:'calendar',label:'学习日期覆盖',defaultVariant:'calendar-heatmap',description:'固定日期与 Asia/Shanghai 时区，区分零值、未知和部分覆盖。'},
] as const);
export function labMetric(dataset:LabDatasetId,state:LabDataState='normal'):HudMetric{
  const scene=dataset==='series'?fixtureScene('trend-line'):dataset==='progress'?fixtureScene('progress-ring'):dataset==='number'?fixtureScene('numeric'):dataset==='input'?fixtureScene('input-pulse'):batch2FixtureScene(dataset==='groups'?'bar-chart':dataset==='target'?'target-band':'calendar-heatmap');
  let metric=Object.values(scene.metrics)[0];
  if(dataset==='series'&&metric.kind==='trend')metric={...metric,unit:'graphemes',points:metric.points.map((p,i)=>({...p,value:p.value===null?null:[1,2,0,4,3,0,0,4,5,3,6,5][i]}))};
  if(state==='no-data')return{...metric,state:{status:'no-data',message:'Fixture: no observations provided'}};
  if(state==='error')return{...metric,state:{status:'error',message:'Fixture: source temporarily unavailable'}};
  if(state==='paused')return{...metric,state:{status:'paused',frozenAtMs:LAB_CLOCK.nowMs}};
  if(state==='missing'){
    switch(metric.kind){
      case 'number':return{...metric,value:null};
      case 'trend':return{...metric,points:metric.points.map((p,i)=>i===1||i===2||i===8?{...p,value:null,quality:'unmeasured',state:'missing',sourceEventIds:[]}:p)};
      case 'progress':return{...metric,denominator:null};
      case 'input-pulse':return{...metric,state:{status:'no-data',message:'Fixture: input-event coverage unavailable; no waveform invented'}};
      case 'bar':return{...metric,groups:metric.groups.map((g,i)=>i===0?{...g,value:null,coverage:'unknown',sourceEventIds:[]}:g)};
      case 'target-band':return{...metric,target:{min:null,max:null}};
      case 'calendar':return{...metric,days:metric.days.map((d,i)=>i<4?{...d,value:null,coverage:'unknown',sourceEventIds:[]}:d)};
    }
  }
  return metric;
}
export function specimenSize(variant:HudVariantId,requested:{width:number;height:number}){
  if(![requested.width,requested.height].every(n=>Number.isFinite(n)&&n>0))throw new RangeError('Specimen size must be finite and positive');
  const min=HUD_REGISTRY[variantToNodeType(variant)].minSize;
  return{width:Math.max(min.width,Math.min(720,requested.width)),height:Math.max(min.height,Math.min(420,requested.height))};
}
export function makeVariantScene(metric:HudMetric,variant:HudVariantId,options:{size?:{width:number;height:number};accent?:string;label?:string;motion?:'subtle'|'none'}={}):HudScene{
  const choice=presentationOptions(metric).find(option=>option.id===variant);
  if(!choice?.compatible)throw new Error(`Incompatible presentation: ${variant}. ${choice?.reason??''}`);
  const type=variantToNodeType(variant),size=specimenSize(variant,options.size??{width:480,height:280});
  const style:HudStyle=options.accent?{colors:{accent:options.accent,accentSoft:options.accent+'55'}}:{};
  const base={id:'variant-specimen',schemaVersion:1 as const,metricBinding:{metricKey:metric.metricId,metricVersion:metric.metricVersion,schemaVersion:metric.schemaVersion,unit:metric.unit,source:metric.source},label:options.label??'Same source / new presentation',position:{x:0,y:0},size,anchor:'top-left' as const,zIndex:0,motion:options.motion??'subtle',style};
  let node:HudNode;
  switch(type){
    case 'numeric':node={...base,type,precision:0};break;
    case 'trend-line':node={...base,type,maxGapMs:3000};break;
    case 'trend-bars':node={...base,type};break;
    case 'input-pulse':node={...base,type,windowMs:10000,visualization:pulseVisualizationForVariant(variant)!};break;
    case 'progress-ring':case 'progress-track':node={...base,type,precision:0};break;
    default:node={...base,type};break;
  }
  return{schemaVersion:1,size,safeBounds:{x:0,y:0,...size},nodes:[node],metrics:{[metric.metricId]:metric}};
}
export function comparableVariants(metric:HudMetric):readonly HudVariantId[]{return presentationOptions(metric).filter(option=>option.compatible).map(option=>option.id);}
