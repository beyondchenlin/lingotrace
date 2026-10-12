import type { BarMetric, CalendarMetric, TargetBandMetric } from './schema.ts';
import { calendarCells } from './calendar.ts';
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const shortText=(v:unknown,max=80):v is string=>typeof v==='string'&&v.length>0&&v.length<=max;
const provenance=(v:unknown)=>Array.isArray(v)&&v.every(id=>shortText(id,160));
const quantityUnits=['count','words','graphemes','seconds','milliseconds'];
function coverageErrors(value:unknown,coverage:unknown):string[]{
  const errors:string[]=[];
  if(!['complete','partial','unknown'].includes(coverage as string))errors.push('coverage must be complete, partial or unknown');
  if(value!==null&&(!finite(value)||value<0))errors.push('quantity must be finite, nonnegative or null');
  if(coverage==='unknown'&&value!==null)errors.push('unknown coverage requires null, not a fabricated quantity');
  if(coverage==='complete'&&value===null)errors.push('complete coverage requires an observed quantity, including actual zero');
  return errors;
}
export function validateBatch2Metric(metric:BarMetric|TargetBandMetric|CalendarMetric):readonly string[]{
  const errors:string[]=[];
  if(metric.kind==='bar'){
    if(!quantityUnits.includes(metric.unit))errors.push('bar requires a count or duration unit');
    if(!object(metric.grouping)||!['interval','sentence','category'].includes(metric.grouping.kind)||!shortText(metric.grouping.label))errors.push('bar grouping kind and label are required');
    if(!object(metric.domain)||metric.domain.min!==0||!finite(metric.domain.max)||metric.domain.max<=0)errors.push('bar domain must start at zero and have a positive finite maximum');
    if(!Array.isArray(metric.groups)||metric.groups.length<1||metric.groups.length>8)return [...errors,'bar requires 1..8 explicit groups'];
    if(metric.grouping?.kind!=='interval'&&metric.grouping?.intervalUnit!==undefined)errors.push('only interval grouping can declare an interval unit');
    const seen=new Set<string>();let lastEnd=-Infinity;
    for(const group of metric.groups as BarMetric['groups']){
      if(!object(group)){errors.push('bar group must be an object');continue;}
      if(!shortText(group.id,160)||seen.has(group.id)||!shortText(group.label,48)||!provenance(group.sourceEventIds))errors.push('invalid group ID, label or provenance');seen.add(group.id);
      errors.push(...coverageErrors(group.value,group.coverage));
      if(finite(group.value)&&object(metric.domain)&&group.value>metric.domain.max)errors.push('bar quantity exceeds the explicit value domain');
      if(metric.grouping?.kind==='interval'){
        if(!['seconds','milliseconds'].includes(metric.grouping.intervalUnit!))errors.push('interval grouping requires an explicit seconds/milliseconds unit');
        if(!object(group.interval)||!finite(group.interval.start)||!finite(group.interval.end)||group.interval.start<0||group.interval.end<=group.interval.start||group.interval.start<lastEnd)errors.push('bar intervals must be finite, positive-length, ordered and non-overlapping');
        if(group.interval)lastEnd=group.interval.end;
      }else if(group.interval!==undefined)errors.push('non-interval groups must not carry an interval');
    }
  }else if(metric.kind==='target-band'){
    if(metric.value!==null&&!finite(metric.value))errors.push('target actual value must be finite or null');
    const t=metric.target,s=metric.scale;
    if(!object(s)||!finite(s.min)||!finite(s.max)||s.min>=s.max||!finite(s.max-s.min))errors.push('target scale requires finite increasing bounds');
    if(!object(t))return [...errors,'target requires explicit min/max, or null for unknown'];
    if((t.min!==null&&!finite(t.min))||(t.max!==null&&!finite(t.max)))errors.push('target bounds must be finite or null');
    if(finite(t.min)&&finite(t.max)&&t.min>t.max)errors.push('target minimum must not exceed maximum');
    if(object(s)&&((finite(t.min)&&(t.min<s.min||t.min>s.max))||(finite(t.max)&&(t.max<s.min||t.max>s.max))))errors.push('display scale must contain the target interval');
  }else{
    if(!quantityUnits.includes(metric.unit))errors.push('calendar requires a count or duration unit');
    if(typeof metric.timezone!=='string'||metric.timezone.length>80||!/^(UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/.test(metric.timezone))errors.push('calendar requires an explicit IANA timezone');
    else try{new Intl.DateTimeFormat('en',{timeZone:metric.timezone});}catch{errors.push('unsupported calendar timezone');}
    if(!object(metric.colorDomain)||metric.colorDomain.min!==0||!finite(metric.colorDomain.max)||metric.colorDomain.max<=0)errors.push('calendar color domain must start at zero with positive finite maximum');
    let expected:ReturnType<typeof calendarCells>;
    try{expected=calendarCells(metric.startDate,metric.endDate,metric.weekStartsOn);}catch{return [...errors,'calendar dates/window/week start are invalid'];}
    if(!Array.isArray(metric.days)||metric.days.length!==expected.length)return [...errors,'calendar requires exactly one explicit row per date in the window'];
    for(const [index,day] of (metric.days as CalendarMetric['days']).entries()){
      if(!object(day)){errors.push('calendar day must be an object');continue;}
      if(day.date!==expected[index].date)errors.push('calendar dates must be unique, complete and ordered');
      if(!provenance(day.sourceEventIds))errors.push('invalid calendar day provenance');
      errors.push(...coverageErrors(day.value,day.coverage));
      if(finite(day.value)&&object(metric.colorDomain)&&day.value>metric.colorDomain.max)errors.push('calendar quantity exceeds its explicit color domain');
    }
  }
  return errors;
}
