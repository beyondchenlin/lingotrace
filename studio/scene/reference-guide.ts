/** Page-local guide with a bounded tab-only pending disclosure marker, never answer/input storage. */
export function guideSegments(text:string):{segment:string;index:number}[]{
 if(typeof Intl.Segmenter==='function')return Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>({segment:part.segment,index:part.index}));
 let index=0;return Array.from(text,segment=>{const part={segment,index};index+=segment.length;return part});
}
export function referenceGuideText(draft:string,reference:string){const expected=guideSegments(reference),count=guideSegments(draft).length;return draft+(expected[count]?reference.slice(expected[count].index):'')}
export interface ReferenceGuideIdentity {sessionId:string;material:{id:string;version:string;cues:readonly {id:string;text:string}[]};cueIndex:number}
/** Material versions identify immutable reference text. No answer text enters the marker. */
export function referenceGuideKey(snapshot:ReferenceGuideIdentity){return JSON.stringify([snapshot.sessionId,snapshot.material.id,snapshot.material.version,snapshot.material.cues[snapshot.cueIndex]?.id])}
export const REFERENCE_DISCLOSURE_STORAGE_KEY='lingotrace.pending-reference-disclosure.v1';
type TabStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export class ReferenceGuideExposure {
 private seen=new Set<string>();private pending=new Set<string>();private storage:TabStorage|null=null;private persistent=false;private session:string|null=null;private failed=false;
 get unavailable(){return this.failed}
 attach(storage:TabStorage|null){this.storage=storage;this.persistent=!!storage;if(!storage){this.failed=true;return}try{const raw=storage.getItem(REFERENCE_DISCLOSURE_STORAGE_KEY);if(!raw)return;const value:unknown=JSON.parse(raw);if(!Array.isArray(value)||value.length>2048||!value.every(key=>typeof key==='string'&&key.length<=2048&&Array.isArray(JSON.parse(key))&&JSON.parse(key).length===4))throw Error('Invalid pending disclosure');this.pending=new Set(value);for(const key of value)this.seen.add(key)}catch{this.failed=true}}
 /** Privacy OFF removes the tab marker immediately; current in-memory exposure stays truthful. */
 setPersistence(enabled:boolean){if(enabled===this.persistent)return;this.persistent=enabled&&!!this.storage;if(!enabled){this.pending.clear();try{this.storage?.removeItem(REFERENCE_DISCLOSURE_STORAGE_KEY)}catch{this.failed=true}}}
 syncSession(snapshot:ReferenceGuideIdentity){if(this.session===snapshot.sessionId)return;const previous=this.session;this.session=snapshot.sessionId;if(previous!==null){this.seen.clear();this.pending.clear();try{this.storage?.removeItem(REFERENCE_DISCLOSURE_STORAGE_KEY)}catch{this.failed=true}}else{for(const key of [...this.seen])if(JSON.parse(key)[0]!==snapshot.sessionId)this.seen.delete(key);for(const key of [...this.pending])if(JSON.parse(key)[0]!==snapshot.sessionId)this.pending.delete(key)}}
 observe(snapshot:ReferenceGuideIdentity):boolean{this.syncSession(snapshot);const key=referenceGuideKey(snapshot);if(this.failed)return false;if(this.persistent&&!this.pending.has(key)){if(this.pending.size>=2048){this.failed=true;return false}this.pending.add(key);try{this.storage!.setItem(REFERENCE_DISCLOSURE_STORAGE_KEY,JSON.stringify([...this.pending]))}catch{this.pending.delete(key);this.failed=true;return false}}this.seen.add(key);return true}
 /** Existing attempt conditions remain the only scored source. Failed provenance is conservatively assisted. */
 apply(engine:{getSnapshot:()=>ReferenceGuideIdentity;exposeHint:(kind:'hint'|'reveal')=>void},alreadyRevealed:boolean,alreadyHinted=false){this.syncSession(engine.getSnapshot());if(alreadyRevealed)return;if(this.seen.has(referenceGuideKey(engine.getSnapshot())))engine.exposeHint('reveal');else if(this.failed&&!alreadyHinted)engine.exposeHint('hint')}
 has(snapshot:ReferenceGuideIdentity){return this.seen.has(referenceGuideKey(snapshot))}
}

export interface GuideLine {start:number;end:number;text:string;x:number;y:number;width:number;height:number;baseline:number}
/** Continue from the measured native draft end, never rewrap already typed words. */
export function layoutReferenceRemainder(draft:string,reference:string,display:{lines:GuideLine[];draftEnd?:{x:number;y:number;baseline:number};width:number;paddingX:number;paddingY:number;lineHeight:number},measure:(text:string)=>number):GuideLine[]{
 const suffix=referenceGuideText(draft,reference).slice(draft.length);if(!suffix)return[];
 const last=display.lines.at(-1),left=display.paddingX,right=display.width-display.paddingX,result:GuideLine[]=[];
 let x=display.draftEnd?.x??(last?last.x+last.width:left),y=display.draftEnd?.y??last?.y??display.paddingY,baseline=display.draftEnd?.baseline??last?.baseline??display.paddingY+display.lineHeight*.8,offset=draft.length;
 const nextLine=()=>{x=left;y+=display.lineHeight;baseline+=display.lineHeight};
 const paragraphs=suffix.split('\n');for(let pi=0;pi<paragraphs.length;pi++){
  const paragraph=paragraphs[pi],parts=guideSegments(paragraph);let from=0;
  while(from<parts.length){
   if(x>left&&measure(parts[from].segment)>right-x)nextLine();let to=from,lastBreak=-1;
   while(to<parts.length){const part=parts[to],end=part.index+part.segment.length;if(to>from&&measure(paragraph.slice(parts[from].index,end))>right-x)break;if(/\s/u.test(part.segment))lastBreak=to+1;to++}
   if(to<parts.length&&lastBreak>from)to=lastBreak;
   const begin=parts[from].index,end=parts[to-1].index+parts[to-1].segment.length,text=paragraph.slice(begin,end),width=measure(text);result.push({start:offset+begin,end:offset+end,text,x,y,width,height:display.lineHeight,baseline});x+=width;from=to;if(from<parts.length)nextLine();
  }
  offset+=paragraph.length+1;if(pi<paragraphs.length-1)nextLine();
 }
 return result;
}
