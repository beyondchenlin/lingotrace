import {validatePracticeSnapshot,type PracticeSnapshot} from './practice';
import {csvCell} from './training';

export const PRACTICE_EXPORT_VERSION='lingotrace-practice-export-v1';
export const PRACTICE_EXPORT_VERSION_V2='lingotrace-practice-export-v2';
export interface PracticeExportRow {recordType:string;recordId:string;sessionId:string;sequence:number;payload:unknown}

/** LOW-LEVEL SERIALIZER: this can serialize an arbitrary caller-owned old copy.
 * It grants NO authority to deliver recorded history after deletion. New history
 * UI must use FencedPracticeRepository.prepareHistoryExport/deliverHistoryExport,
 * whose opaque handles recheck deletion generations immediately before delivery.
 * Kept for v1 compatibility, deterministic fixture tests and the repository's
 * internal formatter. Projections are derived views, never new practice facts. */
export function exportPracticeSnapshot(input:PracticeSnapshot,exportedAt:string){
  if(!Number.isFinite(Date.parse(exportedAt)))throw new Error('An explicit valid export timestamp is required.');
  const snapshot=validatePracticeSnapshot(input);
  const rows:PracticeExportRow[]=[
    {recordType:'session',recordId:snapshot.sessionId,sessionId:snapshot.sessionId,sequence:snapshot.sequence,payload:{schemaVersion:snapshot.schemaVersion,sessionId:snapshot.sessionId,sequence:snapshot.sequence}},
    ...snapshot.events.map(event=>({recordType:'event',recordId:event.eventId,sessionId:snapshot.sessionId,sequence:event.sequence,payload:event})),
    {recordType:'projections',recordId:snapshot.sessionId,sessionId:snapshot.sessionId,sequence:snapshot.sequence,payload:snapshot.projections},
  ];
  const document={exportVersion:snapshot.schemaVersion==='lingotrace-practice-v2'?PRACTICE_EXPORT_VERSION_V2:PRACTICE_EXPORT_VERSION,exportedAt,snapshot,rows};
  const columns=['record_type','record_id','session_id','sequence','exported_at','payload_json'];
  const csv='\uFEFF'+[columns.map(csvCell).join(','),...rows.map(row=>[row.recordType,row.recordId,row.sessionId,row.sequence,exportedAt,JSON.stringify(row.payload)].map(csvCell).join(','))].join('\r\n')+'\r\n';
  return{snapshot,rows,json:JSON.stringify(document,null,2),csv};
}
