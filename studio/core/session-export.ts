import{exportSession,csvCell,type TrainingSnapshot}from'./training';
import{derivePaceTimeline}from'./pace-timeline';
import{deriveInputRateTimeline}from'./input-rate-timeline';
/** Both formats are assembled from one immutable captured event boundary. */
export function exportStudioSession(session:TrainingSnapshot,exportedAt?:string){
 const base=exportSession(session,exportedAt),paceTimeline=derivePaceTimeline(base.snapshot.session);
 const inputRateTimeline=deriveInputRateTimeline(base.snapshot.session);
 const snapshot=Object.freeze({...base.snapshot,paceTimeline,inputRateTimeline});
 const header=base.csv.split('\r\n')[0].replace(/^\uFEFF/,'');
 const columns=header.split(',').map(v=>v.slice(1,-1));
 const{points,segments,gaps,markers,issues,...metadata}=paceTimeline;
 const records:{kind:string;id:string;payload:unknown}[]=[{kind:'pace_timeline',id:paceTimeline.version,payload:metadata},
  ...points.map(p=>({kind:'pace_point',id:p.eventId,payload:p})),
  ...segments.map(s=>({kind:'pace_segment',id:s.id,payload:{id:s.id,pointEventIds:s.points.map(p=>p.eventId)}})),
  ...gaps.map(g=>({kind:'pace_gap',id:g.id,payload:g})),
  ...markers.map(m=>({kind:'pace_marker',id:m.at.eventId,payload:m})),
  ...issues.map((issue,i)=>({kind:'pace_issue',id:String(i),payload:issue}))];
 const{points:ratePoints,segments:rateSegments,...rateMetadata}=inputRateTimeline;
 records.push({kind:'input_rate_timeline',id:inputRateTimeline.version,payload:rateMetadata});
 for(const point of ratePoints)records.push({kind:'input_rate_point',id:point.eventId,payload:point});
 for(const segment of rateSegments)records.push({kind:'input_rate_segment',id:segment.id,payload:{id:segment.id,pointEventIds:segment.points.map(point=>point.eventId)}});
 const suffix=records.map(r=>{const row:Record<string,unknown>={record_type:r.kind,session_id:session.sessionId,material_id:session.material.id,material_version:session.material.version,exported_at:base.snapshot.exportedAt,id:r.id,payload_json:JSON.stringify(r.payload)};return columns.map(key=>csvCell(row[key])).join(',')}).join('\r\n')+'\r\n';
 return{snapshot,json:JSON.stringify(snapshot,null,2),csv:base.csv+suffix};
}
