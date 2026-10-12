import {
  canonicalMaterialDigest, captureLocalReference, defaultLocalReferenceDigest,
  type LocalReferenceDigest, type LocalReferenceMaterial, type LocalReferenceReceipt,
} from './local-reference';
import type {LocalReferenceList} from './local-reference-repository';

/** This capability accepts only the repository's recursively validated list.
 * No write, adoption, Training, task, grading or export capability is needed. */
export interface ReferenceRevisionImpactAccess {
  list(): Promise<LocalReferenceList>;
  subscribe(listener: () => void): () => void;
}
export type ReferenceRevisionKind = 'text' | 'timing' | 'text-and-timing' | 'merge' | 'split';
export interface ReferenceRevisionImpact {
  readonly key: string; readonly materialVersion: string; readonly parentVersion: string; readonly createdAt: string;
  readonly relation: 'direct' | 'subsequent'; readonly distance: number; readonly kind: ReferenceRevisionKind;
  readonly affectedHistoricalUnitIds: readonly string[]; readonly parentUnitIds: readonly string[]; readonly unitIds: readonly string[];
}
/** Intentionally excludes before/after text, cues and new reference material. */
export interface ReferenceRevisionImpactResult {
  readonly status: 'matched' | 'no-match'; readonly revisions: readonly ReferenceRevisionImpact[]; readonly unreadableCount: number;
}
interface Identity {readonly materialId: string; readonly version: string; readonly digest: string}
const identity = (value: Identity) => JSON.stringify([value.materialId, value.version, value.digest]);
interface Cursor {readonly identity: string; readonly distance: number; readonly origins: ReadonlyMap<string, readonly string[]>}
function edge(row: LocalReferenceReceipt): {kind: ReferenceRevisionKind; parents: readonly string[]; units: readonly string[]} {
  const binding = row.material.localReference!;
  if (binding.version === 'local-reference-v2') {
    if (!binding.lineage) throw new Error('A verified structural revision must contain unit lineage.');
    return {kind: binding.lineage.operation, parents: binding.lineage.parentUnitIds, units: binding.lineage.unitIds};
  }
  const {before, after, cueId} = row.change;
  const text = before.text !== after.text, timing = before.start !== after.start || before.end !== after.end;
  if (!text && !timing) throw new Error('A verified revision must contain a change.');
  return {kind: text && timing ? 'text-and-timing' : text ? 'text' : 'timing', parents: [cueId], units: [cueId]};
}

/** Match the complete historical material, including unknown retained metadata,
 * to a validated parent digest. Walk only complete identity edges, never cue IDs
 * across versions. Each branch owns its own unit -> historical unit lineage.
 * The supplied list must come from IndexedDBLocalReferenceRepository.list(); this
 * projection is not an admission validator for arbitrary imported receipts. */
export async function deriveReferenceRevisionImpact(material: LocalReferenceMaterial, validated: LocalReferenceList,
  digest: LocalReferenceDigest = defaultLocalReferenceDigest): Promise<ReferenceRevisionImpactResult> {
  const historical = captureLocalReference(material), historyOrder = historical.cues.map(cue => cue.id);
  const root = identity({materialId: historical.id, version: historical.version, digest: await canonicalMaterialDigest(historical, digest)});
  const children = new Map<string, LocalReferenceReceipt[]>();
  for (const row of validated.entries) {
    const parent = identity(row.parent), siblings = children.get(parent) ?? [];
    siblings.push(row); children.set(parent, siblings);
  }
  const queue: Cursor[] = [{identity: root, distance: 0, origins: new Map(historyOrder.map(id => [id, [id]]))}];
  const visited = new Set<string>([root]), revisions: ReferenceRevisionImpact[] = [];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const row of children.get(current.identity) ?? []) {
      const nextIdentity = identity({materialId: row.material.id, version: row.material.version, digest: row.materialDigest});
      if (visited.has(nextIdentity)) continue;
      visited.add(nextIdentity);
      const change = edge(row), affected = new Set(change.parents.flatMap(id => current.origins.get(id) ?? []));
      const affectedHistoricalUnitIds = historyOrder.filter(id => affected.has(id));
      const nextOrigins = new Map(current.origins);
      for (const id of change.parents) nextOrigins.delete(id);
      for (const id of change.units) nextOrigins.set(id, affectedHistoricalUnitIds);
      // Prune only against this edge's verified full material, never a sibling.
      const retained = new Set(row.material.cues.map(cue => cue.id));
      for (const id of nextOrigins.keys()) if (!retained.has(id)) nextOrigins.delete(id);
      const distance = current.distance + 1;
      if (affectedHistoricalUnitIds.length) revisions.push({key: row.key, materialVersion: row.material.version, parentVersion: row.parent.version,
        createdAt: row.createdAt, relation: distance === 1 ? 'direct' : 'subsequent', distance, kind: change.kind,
        affectedHistoricalUnitIds, parentUnitIds: [...change.parents], unitIds: [...change.units]});
      queue.push({identity: nextIdentity, distance, origins: nextOrigins});
    }
  }
  revisions.sort((a, b) => a.distance - b.distance || a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key));
  return captureLocalReference({status: revisions.length ? 'matched' : 'no-match', revisions, unreadableCount: validated.unreadableCount});
}

export interface ReferenceRevisionImpactView {
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable'; readonly result: ReferenceRevisionImpactResult | null;
}
const initialView = (): ReferenceRevisionImpactView => Object.freeze({status: 'idle', result: null});
/** Read-only, lifetime-fenced observer. Invalidation immediately hides old results;
 * absent/corrupt/unavailable evidence can never be displayed as "unchanged". */
export class ReferenceRevisionImpactReader {
  private state = initialView();
  private epoch = 0;
  private active = false;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly repository: ReferenceRevisionImpactAccess, private readonly material: LocalReferenceMaterial,
    private readonly digest: LocalReferenceDigest = defaultLocalReferenceDigest) {}
  getSnapshot = (): ReferenceRevisionImpactView => this.state;
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private update(state: ReferenceRevisionImpactView): void {
    this.state = Object.freeze(state); for (const listener of this.listeners) listener();
  }
  activate(): void {
    this.unsubscribe?.(); this.unsubscribe = null; this.active = true; ++this.epoch;
    try {this.unsubscribe = this.repository.subscribe(() => {void this.refresh();});}
    catch {this.update({status: 'unavailable', result: null}); return;}
    void this.refresh();
  }
  async refresh(): Promise<void> {
    if (!this.active) return;
    const token = ++this.epoch; this.update({status: 'loading', result: null});
    const current = () => this.active && token === this.epoch;
    try {
      const list = await this.repository.list(); if (!current()) return;
      const result = await deriveReferenceRevisionImpact(this.material, list, this.digest);
      if (current()) this.update({status: 'ready', result});
    } catch {if (current()) this.update({status: 'unavailable', result: null});}
  }
  dispose(): void {this.active = false; ++this.epoch; this.unsubscribe?.(); this.unsubscribe = null;}
}
