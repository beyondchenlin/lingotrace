import { HUD_REGISTRY, expectedKind } from './registry.ts';
import { validateBatch2Metric } from './validate-batch2.ts';
import { resolveAnchoredRect } from './layout.ts';
import type { HudMetric, HudNode, HudScene, RenderClock, TrendPoint, InputPulseEvent } from './schema.ts';
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const nonempty=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const ids=(v:unknown):boolean=>Array.isArray(v)&&v.every(nonempty);
const color=(v:unknown):boolean=>typeof v==='string'&&/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(v);
const units=['count','words','graphemes','seconds','milliseconds','percent','graphemes/second','graphemes/minute'];
const sources=['practice-projection','input-event','legacy-training-snapshot','fixture'];
function validateMetric(metric:HudMetric,key:string,errors:string[]){
  const bad=(why:string)=>errors.push(`metric ${key}: ${why}`);
  if(!object(metric)){bad('metric must be an object');return;}
  if(!nonempty(metric.metricId)||metric.metricVersion!==1||!['measured','estimated','unmeasured'].includes(metric.quality)||!ids(metric.sourceEventIds)||(metric.observedAtMs!==null&&(!finite(metric.observedAtMs)||metric.observedAtMs<0)))bad('invalid metric identity, quality or observation provenance');
  if(metric.schemaVersion!==1||!units.includes(metric.unit)||!sources.includes(metric.source))bad('invalid schemaVersion, unit or source');
  if(!object(metric.state)||!['ready','no-data','paused','error'].includes(metric.state.status)){bad('invalid data state');return;}
  if(metric.state.status==='paused'&&(!finite(metric.state.frozenAtMs)||metric.state.frozenAtMs<0))bad('paused state requires a nonnegative frozenAtMs');
  if('message' in metric.state&&metric.state.message!==undefined&&(typeof metric.state.message!=='string'||metric.state.message.length>200))bad('message must be a string of at most 200 characters');
  if(metric.state.status==='error'&&!nonempty(metric.state.message))bad('error state requires a message');
  switch(metric.kind){
    case 'number':if(metric.value!==null&&!finite(metric.value))bad('value must be finite or null');break;
    case 'progress':
      for(const field of ['numerator','denominator'] as const)if(metric[field]!==null&&(!finite(metric[field])||metric[field]!<0))bad(`${field} must be nonnegative or null`);
      if(finite(metric.numerator)&&finite(metric.denominator)&&metric.denominator>0&&!finite(metric.numerator/metric.denominator*100))bad('progress percentage overflows the finite display range');
      break;
    case 'trend':{
      const d=metric.domain;
      if(!object(d)||![d.startMs,d.endMs,d.min,d.max].every(finite)||d.startMs<0||d.endMs<=d.startMs||d.max<=d.min||!finite(d.max-d.min))bad('invalid trend domain');
      if(!Array.isArray(metric.points)||metric.points.length>4096){bad('points must be an array of at most 4096');break;}
      let previous=-1;
      for(const p of metric.points as readonly TrendPoint[]){
        if(!object(p)){bad('point must be an object');continue;}
        if(!finite(p.atMs)||p.atMs<0||p.atMs<=previous||(p.value!==null&&!finite(p.value))||!['measured','estimated','unmeasured'].includes(p.quality)||!ids(p.sourceEventIds)||(p.quality==='unmeasured'&&p.value!==null)||(p.state!==undefined&&!['active','missing','paused'].includes(p.state)))bad('points must be finite and strictly increasing, with valid quality/provenance and explicit null gaps');
        if(p.value!==null&&object(d)&&(p.value<d.min||p.value>d.max))bad('trend observation exceeds the declared domain');
        previous=p.atMs;
      }
      break;
    }
    case 'input-pulse':{
      if(metric.unit!=='graphemes')bad('pulse unit must be graphemes');
      if(!Array.isArray(metric.events)||metric.events.length>2048){bad('events must be an array of at most 2048');break;}
      const seen=new Set<string>();let previous=-1;
      for(const e of metric.events as readonly InputPulseEvent[]){
        if(!object(e)){bad('input event must be an object');continue;}
        if(!nonempty(e.id)||seen.has(e.id)||!finite(e.atMs)||e.atMs<0||e.atMs<previous||!Number.isSafeInteger(e.addedGraphemes)||e.addedGraphemes<0||!['typed','ime','paste','delete','other'].includes(e.source))bad('invalid input event or repeated event ID');
        seen.add(e.id);previous=e.atMs;
      }break;
    }
    case 'bar':case 'target-band':case 'calendar':for(const message of validateBatch2Metric(metric))bad(message);break;
    default:bad('unsupported metric kind');
  }
}
export function validateScene(scene:HudScene,clock:RenderClock):readonly string[]{
  const errors:string[]=[];
  if(!object(scene)||!object(scene.size)||!object(scene.safeBounds)||!object(scene.metrics))return ['scene, size, safeBounds and metrics must be objects'];
  if(scene.schemaVersion!==1)errors.push('unsupported scene schemaVersion');
  if(!object(clock)||!finite(clock.nowMs)||clock.nowMs<0||typeof clock.reducedMotion!=='boolean')errors.push('clock must be explicit, finite and nonnegative');
  if(![scene.size.width,scene.size.height].every(n=>finite(n)&&n>0&&n<=16384))errors.push('scene dimensions must be within 1..16384');
  const b=scene.safeBounds;
  if(![b.x,b.y,b.width,b.height].every(finite)||b.x<0||b.y<0||b.width<=0||b.height<=0||b.x+b.width>scene.size.width||b.y+b.height>scene.size.height)errors.push('safeBounds must be inside the scene');
  if(!Array.isArray(scene.nodes)||scene.nodes.length>128)return [...errors,'nodes must be an array of at most 128'];
  const seen=new Set<string>();
  for(const node of scene.nodes as readonly HudNode[]){
    if(!object(node)){errors.push('node must be an object');continue;}
    const bad=(why:string)=>errors.push(`node ${String(node.id)}: ${why}`);
    if(!nonempty(node.id)||seen.has(node.id))bad('id must be unique and nonempty');seen.add(node.id);
    const registration=Object.hasOwn(HUD_REGISTRY,node.type)?HUD_REGISTRY[node.type]:null;
    if(!registration||registration.status!=='implemented'){bad('component is not implemented');continue;}
    if(!object(node.metricBinding)||!object(node.size)||!object(node.position)){bad('binding, size and position must be objects');continue;}
    if(node.schemaVersion!==1||node.metricBinding.schemaVersion!==1||node.metricBinding.metricVersion!==1)bad('unsupported node/binding schemaVersion');
    if(!nonempty(node.metricBinding.metricKey))bad('metricKey must be a nonempty string');
    if(!nonempty(node.label)||node.label.length>80||(node.description!==undefined&&(typeof node.description!=='string'||node.description.length>160)))bad('invalid label or description');
    if(!Number.isSafeInteger(node.zIndex)||Math.abs(node.zIndex)>10000)bad('zIndex must be a bounded integer');
    if(!['subtle','none'].includes(node.motion))bad('invalid motion policy');
    if(node.size.width<registration.minSize.width||node.size.height<registration.minSize.height)bad(`size is below ${registration.minSize.width}×${registration.minSize.height}`);
    try{const r=resolveAnchoredRect(node.position,node.size,node.anchor);if(r.x<b.x||r.y<b.y||r.x+r.width>b.x+b.width||r.y+r.height>b.y+b.height)bad('component exceeds safe bounds');}catch{bad('invalid position, size or anchor');}
    if(node.style!==undefined&&!object(node.style))bad('style must be an object');
    if(object(node.style)){
      const s=node.style;
      if(s.opacity!==undefined&&(!finite(s.opacity)||s.opacity<0||s.opacity>1))bad('opacity must be within 0..1');
      if(s.colors!==undefined&&(!object(s.colors)||Object.values(s.colors).some(c=>!color(c))))bad('color slots must use #RRGGBB or #RRGGBBAA');
      if(s.backplate!==undefined&&(!object(s.backplate)||!color(s.backplate.color)||!finite(s.backplate.opacity)||s.backplate.opacity<0||s.backplate.opacity>1))bad('invalid backplate');
      if(s.textOutline!==undefined&&(!object(s.textOutline)||!color(s.textOutline.color)||!finite(s.textOutline.width)||s.textOutline.width<0||s.textOutline.width>6))bad('invalid text outline');
      if(s.font!==undefined&&!object(s.font))bad('font must be an object');
      if(object(s.font))for(const [key,val] of Object.entries(s.font)){
        if(key==='labelSize'||key==='valueSize'){if(!finite(val)||val<8||val>128)bad('font sizes must be within 8..128');}
        else if(!nonempty(val)||val.length>200)bad('font family invalid');
      }
    }
    if(node.type==='numeric'&&(![0,1,2].includes(node.precision)||(node.suffix!==undefined&&(typeof node.suffix!=='string'||node.suffix.length>16))))bad('invalid numeric format');
    if((node.type==='progress-ring'||node.type==='progress-track')&&![0,1].includes(node.precision))bad('invalid ring precision');
    if(node.type==='trend-line'&&(!finite(node.maxGapMs)||node.maxGapMs<=0))bad('maxGapMs must be positive');
    if(node.type==='input-pulse'&&!['wave-scan','event-stems'].includes(node.visualization))bad('invalid pulse visualization');
    if(node.type==='input-pulse'&&(!finite(node.windowMs)||node.windowMs<1000||node.windowMs>60000))bad('windowMs must be within 1000..60000');
    const metric=Object.hasOwn(scene.metrics,node.metricBinding.metricKey)?scene.metrics[node.metricBinding.metricKey]:undefined;
    if(!object(metric)){bad('metric binding not found or invalid');continue;}
    validateMetric(metric,node.metricBinding.metricKey,errors);
    if(node.type==='trend-bars'&&metric.kind==='trend'&&metric.domain&&(metric.domain.min>0||metric.domain.max<0))bad('time bars require an explicit zero baseline inside the declared domain');
    if(metric.metricId!==node.metricBinding.metricKey||metric.metricVersion!==node.metricBinding.metricVersion||metric.kind!==expectedKind(node.type)||metric.unit!==node.metricBinding.unit||metric.source!==node.metricBinding.source)bad('metric binding identity, kind, unit or source mismatch');
  }
  return errors;
}
