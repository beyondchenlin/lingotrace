import {graphemes,normalizeComparisonText,tokens,type Attempt} from '../core/training';

export interface LetterFeedbackRange {start:number;end:number;kind:'correct'|'wrong'}
interface Origin {start:number;end:number}
interface MappedToken {text:string;origins:Origin[]}
const EMPTY_RANGES=Object.freeze([]) as readonly never[];
// Presentation limits only. Native/restored text and formal grading are never truncated.
export const MAX_FEEDBACK_TEXT_UTF16=8192;
export const MAX_FEEDBACK_UNITS=4096;
export const MAX_FEEDBACK_CELLS=4_000_000;
/** Use the checker's normalization and English token rules, retaining complete native graphemes. */
function mappedTokens(text:string):MappedToken[]{
 let normalized='',offset=0;const origins:Origin[]=[];
 for(const part of graphemes(text)){
  const value=normalizeComparisonText(part),origin={start:offset,end:offset+part.length};
  normalized+=value;for(let i=0;i<value.length;i++)origins.push(origin);offset+=part.length;
 }
 const matches=Array.from(normalized.matchAll(/[a-z0-9]+(?:'[a-z0-9]+)*/g)),expected=tokens(text);
 // A future normalization change must fail neutral, never misplace a colored glyph.
 if(matches.length!==expected.length||matches.some((part,i)=>part[0]!==expected[i]))return[];
 return matches.map(part=>({text:part[0],origins:origins.slice(part.index!,part.index!+part[0].length)}));
}

/** Only the exact submitted answer may show checked word errors. */
let checkedCache:{attempt:WeakRef<Attempt>;draft:string;ranges:readonly Origin[]}|undefined;
export function submittedErrorRanges(attempt:Attempt|null,draft:string):readonly Origin[]{
 if(!attempt||attempt.answer!==draft||draft.length>MAX_FEEDBACK_TEXT_UTF16)return EMPTY_RANGES;
 if(checkedCache?.attempt.deref()===attempt&&checkedCache.draft===draft)return checkedCache.ranges;
 const parts=mappedTokens(draft),alignment=attempt.alignment.filter(token=>token.kind!=='missing');
 const ranges=parts.length!==alignment.length||parts.some((part,index)=>part.text!==alignment[index].actual)?EMPTY_RANGES:
  Object.freeze(parts.flatMap((part,index)=>alignment[index].kind==='match'?[]:[Object.freeze({start:part.origins[0].start,end:part.origins.at(-1)!.end})]));
 checkedCache={attempt:new WeakRef(attempt),draft,ranges};return ranges;
}

interface Unit extends Origin {text:string;boundary:boolean}
function inputUnits(text:string):Unit[]{
 const parts=mappedTokens(text),units:Unit[]=[];
 for(let i=0;i<parts.length;i++){
  const part=parts[i];
  if(i){
   const before=parts[i-1].origins.at(-1)!,after=part.origins[0];
   // NFKC can split one glyph into tokens (½ → 1⁄2). A normalized
   // boundary inside that glyph belongs to the whole native grapheme.
   units.push({text:' ',start:after.start<=before.end?before.start:before.end,end:after.start<before.end?Math.max(before.end,after.end):after.start,boundary:true});
  }
  for(let j=0;j<part.text.length;j++)units.push({...part.origins[j],text:part.text[j],boundary:false});
 }
 return units;
}
const cache=new Map<string,readonly LetterFeedbackRange[]>();
function remember(key:string,ranges:readonly LetterFeedbackRange[]){cache.set(key,ranges);if(cache.size>8)cache.delete(cache.keys().next().value!);return ranges}
/**
 * Presentation only: minimum grapheme edits against an expected prefix, then
 * maximum genuine matches. Unentered suffixes/missing letters have no native
 * span and never turn the ghost text red. No attempts, events, rewards or audio.
 */
export function liveLetterFeedback(draft:string,visibleReference:string|undefined):readonly LetterFeedbackRange[]{
 if(visibleReference===undefined||!draft||draft.length>MAX_FEEDBACK_TEXT_UTF16||visibleReference.length>MAX_FEEDBACK_TEXT_UTF16)return EMPTY_RANGES;
 const key=JSON.stringify([draft,visibleReference]),cached=cache.get(key);if(cached)return cached;
 const expected=Array.from(tokens(visibleReference).join(' ')),actual=inputUnits(draft);
 // Restored values can exceed native maxLength. Bound raw input before any
 // normalization, and cache neutral projections so RAF cannot repeat that work.
 if(!expected.length||!actual.length||expected.length>MAX_FEEDBACK_UNITS||actual.length>MAX_FEEDBACK_UNITS||expected.length*actual.length>MAX_FEEDBACK_CELLS)return remember(key,EMPTY_RANGES);
 const width=expected.length+1,steps=new Uint8Array(width*(actual.length+1));
 let previousCost=new Uint32Array(width),previousMatches=new Uint32Array(width);
 let cost=new Uint32Array(width),matches=new Uint32Array(width);
 for(let i=1;i<width;i++){previousCost[i]=i;steps[i]=1}
 for(let j=1;j<=actual.length;j++){
  cost[0]=j;matches[0]=0;steps[j*width]=2;
  for(let i=1;i<width;i++){
   const same=expected[i-1]===actual[j-1].text;
   let best=previousCost[i-1]+(same?0:1),count=previousMatches[i-1]+(same?1:0),step=0;
   const missing=cost[i-1]+1,missingMatches=matches[i-1];
   if(missing<best||(missing===best&&missingMatches>count)){best=missing;count=missingMatches;step=1}
   const extra=previousCost[i]+1,extraMatches=previousMatches[i];
   if(extra<best||(extra===best&&extraMatches>count)){best=extra;count=extraMatches;step=2}
   cost[i]=best;matches[i]=count;steps[j*width+i]=step;
  }
  const oldCost=previousCost,oldMatches=previousMatches;previousCost=cost;previousMatches=matches;cost=oldCost;matches=oldMatches;
 }
 // Expected text after the optimal endpoint is still untyped, not an error.
 let i=0,j=actual.length;
 for(let end=1;end<width;end++)if(previousCost[end]<previousCost[i]||(previousCost[end]===previousCost[i]&&previousMatches[end]>previousMatches[i]))i=end;
 const ranges:LetterFeedbackRange[]=[];
 while(j){
  const step=steps[j*width+i];if(step===1){i--;continue}
  const unit=actual[j-1],correct=step===0&&expected[i-1]===unit.text;
  // Normalized punctuation/whitespace boundaries stay neutral when matching.
  if(!unit.boundary||!correct)ranges.push({start:unit.start,end:unit.end,kind:correct?'correct':'wrong'});
  j--;if(step===0)i--;
 }
 ranges.reverse();
 // NFKC may expand one grapheme (e.g. a ligature) into several ASCII letters.
 // Its native glyph is indivisible; a wrong part takes precedence for that glyph.
 const result:LetterFeedbackRange[]=[];
 for(const range of ranges){
  const last=result.at(-1);
  if(last&&range.start<last.end){last.end=Math.max(last.end,range.end);if(range.kind==='wrong')last.kind='wrong'}
  else result.push({...range});
 }
 const runs:LetterFeedbackRange[]=[];
 for(const range of result){const last=runs.at(-1);if(last&&last.end===range.start&&last.kind===range.kind)last.end=range.end;else runs.push({...range})}
 return remember(key,Object.freeze(runs.map(range=>Object.freeze(range))));
}

export function inputLetterFeedback(draft:string,reference:string|undefined,attempt:Attempt|null,composing=false):{mode:'none'|'live'|'checked';ranges:readonly LetterFeedbackRange[]}{
 if(composing)return{mode:'none',ranges:EMPTY_RANGES};
 if(attempt?.answer===draft)return{mode:'checked',ranges:submittedErrorRanges(attempt,draft).map(range=>({...range,kind:'wrong' as const}))};
 const ranges=liveLetterFeedback(draft,reference);return{mode:ranges.length?'live':'none',ranges};
}
