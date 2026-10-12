import type { DataState, HudMetric, HudNode, HudScene } from '../schema.ts';
export const SPECIMEN_SIZE = { width: 480, height: 270 } as const;
export const FIXTURE_CLOCK = { nowMs: 30000, reducedMotion: false } as const;
export const COMPONENT_TYPES = ['numeric','trend-line','input-pulse','progress-ring'] as const;
export type CoreComponentType = typeof COMPONENT_TYPES[number];
export function fixtureScene(type: CoreComponentType, state: DataState = {status:'ready'}): HudScene {
  const key=`fixture.${type}.v1`;
  const provenance={schemaVersion:1 as const,metricId:key,metricVersion:1 as const,source:'fixture' as const,state,quality:'measured' as const,observedAtMs:30000,sourceEventIds:['fixture-01']};
  const base={id:`sample-${type}`,schemaVersion:1 as const,position:{x:0,y:0},size:SPECIMEN_SIZE,anchor:'top-left' as const,zIndex:0,motion:'subtle' as const};
  let node:HudNode,metric:HudMetric;
  if(type==='numeric'){
    metric={...provenance,kind:'number',unit:'words',value:128};
    node={...base,type,label:'Confirmed words',description:'COUNT / supplied projection',precision:0,suffix:'WORDS',metricBinding:{metricKey:key,metricVersion:1,schemaVersion:1,source:'fixture',unit:'words'},style:{font:{valueSize:76},textOutline:{color:'#101b1d',width:1}}};
  }else if(type==='trend-line'){
    metric={...provenance,kind:'trend',unit:'graphemes/second',domain:{startMs:0,endMs:30000,min:0,max:6},points:[1,2,1.5,3,2.5,null,null,3.5,4,3,5,4].map((value,i)=>({atMs:i*2500,value,quality:value===null?'unmeasured':'measured',sourceEventIds:[`fixture-point-${i}`],state:value===null?'paused':'active'}))};
    node={...base,type,label:'Input trend',description:'GRAPHEMES / SECOND · pause remains a gap',maxGapMs:3000,metricBinding:{metricKey:key,metricVersion:1,schemaVersion:1,source:'fixture',unit:'graphemes/second'},style:{colors:{accent:'#a5c8ee'}}};
  }else if(type==='input-pulse'){
    metric={...provenance,kind:'input-pulse',unit:'graphemes',events:[21500,22400,22900,23200,24700,25100,26500,27100,27900,28300,29000,29500].map((atMs,i)=>({id:`fixture-input-${i}`,atMs,source:i===5?'ime':'typed',addedGraphemes:i===5?3:1}))};
    node={...base,type,label:'Input rhythm',description:'COMMITTED INPUT / deterministic event-driven wave',windowMs:10000,visualization:'wave-scan',metricBinding:{metricKey:key,metricVersion:1,schemaVersion:1,source:'fixture',unit:'graphemes'},style:{colors:{accent:'#72d6c4'}}};
  }else{
    metric={...provenance,kind:'progress',unit:'count',numerator:18,denominator:24};
    node={...base,type,label:'Practice target',description:'18 COMPLETED / 24 SUPPLIED TARGET',precision:0,metricBinding:{metricKey:key,metricVersion:1,schemaVersion:1,source:'fixture',unit:'count'},style:{colors:{accent:'#e8bc76'}}};
  }
  return {schemaVersion:1,size:SPECIMEN_SIZE,safeBounds:{x:0,y:0,...SPECIMEN_SIZE},nodes:[node],metrics:{[key]:metric}};
}
