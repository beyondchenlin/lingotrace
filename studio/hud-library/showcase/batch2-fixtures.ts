import type { BarMetric, CalendarMetric, DataState, HudMetric, HudNode, HudScene, TargetBandMetric } from '../schema.ts';
import { calendarCells } from '../calendar.ts';
export const BATCH2_TYPES=['bar-chart','target-band','calendar-heatmap'] as const;
export type Batch2Type=typeof BATCH2_TYPES[number];
export const BATCH2_SIZE={width:480,height:300} as const;
export const BATCH2_CLOCK={nowMs:30000,reducedMotion:false} as const;
export function batch2FixtureScene(type:Batch2Type,state:DataState={status:'ready'}):HudScene{
  const key=`fixture.${type}.v1`,base={schemaVersion:1 as const,metricId:key,metricVersion:1 as const,unit:'count' as const,source:'fixture' as const,state,quality:'measured' as const,observedAtMs:30000,sourceEventIds:['fixture-batch2']};
  const nodeBase={id:`sample-${type}`,schemaVersion:1 as const,position:{x:0,y:0},size:BATCH2_SIZE,anchor:'top-left' as const,zIndex:0,motion:'none' as const};
  let node:HudNode,metric:HudMetric;
  if(type==='bar-chart'){
    metric={...base,kind:'bar',unit:'seconds',grouping:{kind:'sentence',label:'Observed practice time / sentence'},domain:{min:0,max:30},groups:[
      {id:'s1',label:'SENTENCE 01',value:18.5,coverage:'complete',sourceEventIds:['fixture-s1']},
      {id:'s2',label:'SENTENCE 02',value:26,coverage:'complete',sourceEventIds:['fixture-s2']},
      {id:'s3',label:'SENTENCE 03',value:0,coverage:'complete',sourceEventIds:['fixture-s3']},
      {id:'s4',label:'SENTENCE 04',value:null,coverage:'unknown',sourceEventIds:[]},
      {id:'s5',label:'SENTENCE 05',value:12.4,coverage:'partial',sourceEventIds:['fixture-s5']},
    ]} satisfies BarMetric;
    node={...nodeBase,type,label:'Practice by sentence',metricBinding:{metricKey:key,metricVersion:1,schemaVersion:1,source:'fixture',unit:'seconds'},style:{colors:{accent:'#9fbeea',accentSoft:'#496984'}}};
  }else if(type==='target-band'){
    metric={...base,kind:'target-band',value:67,target:{min:20,max:50},scale:{min:0,max:60}} satisfies TargetBandMetric;
    node={...nodeBase,type,label:'Explicit target interval',metricBinding:{metricKey:key,metricVersion:1,schemaVersion:1,source:'fixture',unit:'count'},style:{colors:{accent:'#e8bc76',accentSoft:'#655338'}}};
  }else{
    const values=[0,4,8,12,null,16,3, 2,6,0,14,18,20,6, null,null,5,8,12,2,0, 4,8,16,20,13,4,0, 3,7,10,null,16,8,2, 0,6,9,15,18,20,6, 4,0,7,12,16,null,0];
    const days=calendarCells('2026-08-17','2026-10-04','monday').map((d,i)=>({date:d.date,value:values[i],coverage:values[i]===null?'unknown' as const:[6,19,33].includes(i)?'partial' as const:'complete' as const,sourceEventIds:values[i]===null?[]:[`fixture-day-${i}`]}));
    metric={...base,kind:'calendar',timezone:'Asia/Shanghai',startDate:'2026-08-17',endDate:'2026-10-04',weekStartsOn:'monday',colorDomain:{min:0,max:20},days} satisfies CalendarMetric;
    node={...nodeBase,type,label:'Learning calendar',metricBinding:{metricKey:key,metricVersion:1,schemaVersion:1,source:'fixture',unit:'count'},style:{colors:{accent:'#a7d684',accentSoft:'#426541'}}};
  }
  return{schemaVersion:1,size:BATCH2_SIZE,safeBounds:{x:0,y:0,...BATCH2_SIZE},nodes:[node],metrics:{[key]:metric}};
}
