/** Temporary, page-local input fixture adapter. This is not a PracticeSnapshot adapter. */
import type { HudNode, HudScene, InputPulseEvent, TrendPoint } from '../schema.ts';
import { fixtureScene, type CoreComponentType } from './fixtures.ts';
export type InputSample = Readonly<{
  text:string;events:readonly InputPulseEvent[];points:readonly TrendPoint[];total:number;sequence:number;
  pausedAtMs:number|null;lastAtMs:number;startedAtMs:number;
}>;
export function emptyInputSample(atMs:number):InputSample {
  checkTime(atMs);return {text:'',events:[],points:[],total:0,sequence:0,pausedAtMs:null,lastAtMs:atMs,startedAtMs:atMs};
}
function checkTime(atMs:number,previous=0){if(!Number.isFinite(atMs)||atMs<previous)throw new RangeError('Input clock must be finite, nonnegative and monotonic');}
export function insertedGraphemes(previous:string,next:string):number {
  if(typeof Intl.Segmenter!=='function')throw new Error('This input harness requires Intl.Segmenter');
  const segmenter=new Intl.Segmenter('en',{granularity:'grapheme'}),a=Array.from(segmenter.segment(previous),s=>s.segment),b=Array.from(segmenter.segment(next),s=>s.segment);
  let prefix=0;while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;
  let suffix=0;while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  return b.length-prefix-suffix;
}
export function commitInput(sample:InputSample,text:string,source:InputPulseEvent['source'],atMs:number):InputSample {
  checkTime(atMs,sample.lastAtMs);if(sample.pausedAtMs!==null)throw new Error('Input is paused');
  if(text===sample.text)return sample;
  if(text.length>10000)throw new RangeError('Input harness accepts at most 10000 UTF-16 code units');
  const added=source==='typed'||source==='ime'?insertedGraphemes(sample.text,text):0;
  const sequence=sample.sequence+1,event:InputPulseEvent={id:`local-input-${sequence}`,atMs,source,addedGraphemes:added};
  // Each real commit is retained; only typed/IME additions raise the observed effort counter.
  const total=sample.total+added,point:TrendPoint={atMs,value:total,quality:'measured',sourceEventIds:[event.id],state:'active'};
  // Same-time input replaces a displayed sample, not the underlying separate input events.
  const points=sample.points.filter(p=>p.atMs<atMs);
  return {...sample,text,events:[...sample.events,event].slice(-2048),points:[...points,point].slice(-4096),total,sequence,lastAtMs:atMs};
}
export function setInputPaused(sample:InputSample,paused:boolean,atMs:number):InputSample {
  checkTime(atMs,sample.lastAtMs);if(paused===(sample.pausedAtMs!==null))return sample;
  const point:TrendPoint={atMs,value:null,quality:'unmeasured',sourceEventIds:[],state:'paused'};
  return {...sample,points:[...sample.points.filter(p=>p.atMs<atMs),point].slice(-4096),pausedAtMs:paused?atMs:null,lastAtMs:atMs};
}
export function inputScene(type:CoreComponentType,sample:InputSample,nowMs:number,options:Readonly<{freezeTimeline?:boolean}>={}):HudScene {
  checkTime(nowMs,sample.lastAtMs);const reference=fixtureScene(type),key=`local.input.${type}.v1`,clock=sample.pausedAtMs??(options.freezeTimeline?sample.lastAtMs:nowMs);
  const node={...reference.nodes[0],metricBinding:{...reference.nodes[0].metricBinding,metricKey:key,source:'input-event' as const,unit:'graphemes' as const}};
  const base={schemaVersion:1 as const,metricId:key,metricVersion:1 as const,unit:'graphemes' as const,source:'input-event' as const,
    state:sample.pausedAtMs!==null?{status:'paused' as const,frozenAtMs:sample.pausedAtMs}:{status:'ready' as const},quality:'measured' as const,observedAtMs:sample.lastAtMs,sourceEventIds:sample.events.map(e=>e.id)};
  let metric;
  if(type==='numeric'){
    metric={...base,kind:'number' as const,value:sample.total};Object.assign(node,{label:'Typed effort',description:'THIS PAGE / observed added graphemes',suffix:'GRAPHEMES'});
  }else if(type==='input-pulse'){
    metric={...base,kind:'input-pulse' as const,events:sample.events};Object.assign(node,{description:'ACTUAL INPUT / paste and deletion do not pulse'});
  }else if(type==='trend-line'){
    metric={...base,kind:'trend' as const,points:sample.points,domain:{startMs:Math.max(0,clock-30000),endMs:Math.max(30000,clock),min:0,max:Math.max(10,sample.total)}};
    Object.assign(node,{label:'Observed input effort',description:'CUMULATIVE GRAPHEMES / actual commits only',maxGapMs:5000});
  }else{
    metric={...base,kind:'progress' as const,numerator:sample.total,denominator:40};Object.assign(node,{label:'Input sample target',description:'40 GRAPHEME DEMO TARGET / not a learning score'});
  }
  return {...reference,nodes:[node as HudNode],metrics:{[key]:metric}};
}

/** Whitelist native typing; history, drops and replacement/autofill only synchronize text. */
export function classifyInputType(inputType: string): InputPulseEvent['source'] {
  if(inputType==='insertText')return 'typed';
  if(inputType==='insertFromPaste')return 'paste';
  if(inputType.startsWith('delete'))return 'delete';
  return 'other';
}
