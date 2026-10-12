import type {Arrangement} from './transparent-layout';
import {parseResponsiveArrangement} from './responsive-editor';
export type LayoutMode = 'lesson' | 'camera' | 'split';
export interface LayoutConfiguration {readonly layout: LayoutMode; readonly arrangement: Arrangement}
export interface LayoutContext {readonly portrait: boolean; readonly height: number}
interface Transaction {readonly before: LayoutConfiguration; readonly context: LayoutContext; candidate: LayoutConfiguration}
const copy = (value: LayoutConfiguration): LayoutConfiguration => ({layout:value.layout,arrangement:Object.fromEntries(Object.entries(value.arrangement).map(([key,rect])=>[key,{...rect}]))});
function equal(a: LayoutConfiguration,b: LayoutConfiguration): boolean {
 if(a.layout!==b.layout)return false;
 const keys=['media','inset','subtitle','metrics'] as const;
 return keys.every(key=>{const x=a.arrangement[key],y=b.arrangement[key];return !x&&!y||!!x&&!!y&&(['x','y','w','h']as const).every(field=>x[field]===y[field])});
}
/** Page-memory edit/undo only. The controller never writes preferences or facts. */
export class LayoutTransactions {
 private transaction: Transaction|null=null;
 private undoByOrientation = new Map<boolean,{before:LayoutConfiguration;after:LayoutConfiguration}>();
 get original(){return this.transaction?copy(this.transaction.before):null}
 get active(){return this.transaction!==null}
 get context(){return this.transaction?{...this.transaction.context}:null}
 begin(current: LayoutConfiguration,context: LayoutContext): LayoutConfiguration {
  if(this.transaction)throw Error('A layout preview is already active.');
  this.transaction={before:copy(current),candidate:copy(current),context:{...context}};
  return copy(current);
 }
 preview(candidate: LayoutConfiguration): LayoutConfiguration|null {
  const t=this.transaction;if(!t)return null;
  if(!['lesson','camera','split'].includes(candidate.layout))return null;
  // Reuse the same geometry constraints for manual edits, preview and apply.
  t.candidate={layout:candidate.layout,arrangement:parseResponsiveArrangement(candidate.arrangement,t.context.portrait,t.context.height)};
  return copy(t.candidate);
 }
 cancel(): LayoutConfiguration|null {const t=this.transaction;this.transaction=null;return t?copy(t.before):null}
 apply(): LayoutConfiguration|null {
  const t=this.transaction;if(!t)return null;
  this.transaction=null;
  if(!equal(t.before,t.candidate))this.undoByOrientation.set(t.context.portrait,{before:copy(t.before),after:copy(t.candidate)});
  return copy(t.candidate);
 }
 canUndo(current:LayoutConfiguration,portrait:boolean): boolean {
  const undo=this.undoByOrientation.get(portrait);return !this.transaction&&!!undo&&equal(current,undo.after);
 }
 undo(current:LayoutConfiguration,portrait:boolean): LayoutConfiguration|null {
  if(!this.canUndo(current,portrait))return null;
  const undo=this.undoByOrientation.get(portrait)!;this.undoByOrientation.delete(portrait);return copy(undo.before);
 }
}
