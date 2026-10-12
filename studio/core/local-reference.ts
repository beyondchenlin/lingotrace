/** Additive reference metadata only. This module has no Training runtime dependency. */
export const LOCAL_REFERENCE_SCHEMA_VERSION = 'local-reference-library-v1' as const;
export const LOCAL_REFERENCE_TRACK_ID = 'cafe-original-en-v1' as const;
export const LOCAL_REFERENCE_MEDIA_ID = 'cafe-original-video-v1' as const;
export const LOCAL_REFERENCE_MEDIA_SHA256 = '22fc25ade368f351cda21951916e559ff359cf1ac8419fbfa5444e050cdbf740' as const;
export interface LocalReferenceMedia { readonly id: string; readonly sha256: string; readonly durationSeconds: number }
export interface LocalReferenceLineage { readonly operation: 'merge' | 'split'; readonly parentUnitIds: readonly string[]; readonly unitIds: readonly string[] }
export interface LocalReferenceBinding {
  readonly version: 'local-reference-v1' | 'local-reference-v2'; readonly lineage?: LocalReferenceLineage; readonly trackId: string; readonly language: 'en';
  readonly parentVersion: string; readonly editedCueId: string; readonly media: LocalReferenceMedia;
}
export interface LocalReferenceCue { readonly id: string; readonly text: string; readonly start: number; readonly end: number }
/** Structural compatibility avoids the Training -> validator -> Training cycle. */
export interface LocalReferenceMaterial {
  readonly id: string; readonly version: string; readonly title: string; readonly rights: string;
  readonly cues: readonly LocalReferenceCue[]; readonly localReference?: LocalReferenceBinding;
}
export interface LocalReferenceReceipt {
  readonly schemaVersion: typeof LOCAL_REFERENCE_SCHEMA_VERSION; readonly key: string; readonly saveRequestId: string;
  readonly material: LocalReferenceMaterial; readonly materialDigest: string;
  readonly parent: { readonly materialId: string; readonly version: string; readonly digest: string };
  readonly change: { readonly cueId: string; readonly before: LocalReferenceCue; readonly after: LocalReferenceCue };
  readonly createdAt: string; readonly receiptDigest: string;
}
export type LocalReferenceProposal = LocalReferenceReceipt;
export type LocalReferenceDigest = (canonical: string) => Promise<string>;
export type LocalReferenceErrorCode = 'invalid-record' | 'invalid-edit' | 'no-change' | 'stale-reference' | 'storage-conflict' | 'storage-unavailable' | 'closed';
export class LocalReferenceError extends Error {
  readonly code: LocalReferenceErrorCode;
  constructor(code: LocalReferenceErrorCode, message: string) { super(message); this.code = code; this.name = 'LocalReferenceError'; }
}
const badRecord = (message = '此本地参考版本的数据结构无法核验。') => new LocalReferenceError('invalid-record', message);
const hashPattern = /^[a-f0-9]{64}$/;
function identifier(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f]/.test(value); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw badRecord();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw badRecord();
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !Object.hasOwn(property, 'value') || !property.enumerable) throw badRecord();
    result[key] = property.value;
  }
  return result;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = record(value), names = Object.keys(result);
  if (names.length !== keys.length || names.some(key => !keys.includes(key))) throw badRecord();
  return result;
}
/** Complete JSON identity: no omitted unknown keys, getters, lossy values or repair. */
export function canonicalLocalReferenceJSON(value: unknown): string {
  const active = new Set<object>();
  const visit = (item: unknown): string => {
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0)) throw badRecord('参考数据含有不能精确保存的数值。');
      return JSON.stringify(item);
    }
    if (!item || typeof item !== 'object' || active.has(item)) throw badRecord();
    active.add(item);
    let output: string;
    if (Array.isArray(item)) {
      // Reject holes/accessors/extra array fields instead of silently dropping them.
      if (Reflect.ownKeys(item).length !== item.length + 1) throw badRecord();
      const values: string[] = [];
      for (let index = 0; index < item.length; index++) {
        const property = Object.getOwnPropertyDescriptor(item, String(index));
        if (!property || !Object.hasOwn(property, 'value') || !property.enumerable) throw badRecord();
        values.push(visit(property.value));
      }
      output = `[${values.join(',')}]`;
    } else {
      const fields = record(item);
      output = `{${Object.keys(fields).sort().map(key => `${JSON.stringify(key)}:${visit(fields[key])}`).join(',')}}`;
    }
    active.delete(item); return output;
  };
  return visit(value);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
export function captureLocalReference<T>(value: T): T { return freeze(JSON.parse(canonicalLocalReferenceJSON(value))) as T; }
export const defaultLocalReferenceDigest: LocalReferenceDigest = async canonical => {
  if (!globalThis.crypto?.subtle) throw new LocalReferenceError('storage-unavailable', '无法计算完整参考摘要，尚未保存。');
  const bytes = new TextEncoder().encode(canonical);
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
};
async function digestValue(value: unknown, digest: LocalReferenceDigest): Promise<string> {
  const result = await digest(canonicalLocalReferenceJSON(value));
  if (!hashPattern.test(result)) throw badRecord('参考摘要算法未返回有效的 SHA-256。');
  return result;
}
export async function canonicalMaterialDigest(material: LocalReferenceMaterial, digest: LocalReferenceDigest = defaultLocalReferenceDigest): Promise<string> {
  return digestValue(material, digest);
}
function validateMedia(value: unknown): LocalReferenceMedia {
  const media = exact(value, ['id', 'sha256', 'durationSeconds']);
  if (media.id !== LOCAL_REFERENCE_MEDIA_ID || media.sha256 !== LOCAL_REFERENCE_MEDIA_SHA256
    || typeof media.durationSeconds !== 'number' || !Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0) {
    throw new LocalReferenceError('stale-reference', '需要同一原片的已核验字节和实际有限时长，不能使用估计时长。');
  }
  return value as LocalReferenceMedia;
}
function binding(value: unknown): LocalReferenceBinding {
  const shape = record(value), structural = shape.version === 'local-reference-v2';
  const data = exact(value, ['version', 'trackId', 'language', 'parentVersion', 'editedCueId', 'media', ...(structural ? ['lineage'] : [])]);
  if ((!structural && data.version !== 'local-reference-v1') || data.trackId !== LOCAL_REFERENCE_TRACK_ID || data.language !== 'en'
    || !identifier(data.parentVersion) || !identifier(data.editedCueId)) throw badRecord('不支持此参考来源封装。');
  if (structural) {
    const lineage = exact(data.lineage, ['operation', 'parentUnitIds', 'unitIds']);
    if ((lineage.operation !== 'merge' && lineage.operation !== 'split') || !Array.isArray(lineage.parentUnitIds) || !Array.isArray(lineage.unitIds)
      || lineage.parentUnitIds.length !== (lineage.operation === 'merge' ? 2 : 1) || lineage.unitIds.length !== (lineage.operation === 'merge' ? 1 : 2)
      || [...lineage.parentUnitIds, ...lineage.unitIds].some(id => !identifier(id))
      || new Set([...lineage.parentUnitIds, ...lineage.unitIds]).size !== lineage.parentUnitIds.length + lineage.unitIds.length
      || data.editedCueId !== lineage.unitIds[0]) throw badRecord('合并或拆分谱系无效。');
  }
  validateMedia(data.media); return value as LocalReferenceBinding;
}
export function isLocalReferenceBinding(value: unknown): value is LocalReferenceBinding { try { binding(value); return true; } catch { return false; } }
function materialShape(value: unknown): asserts value is LocalReferenceMaterial {
  const material = record(value);
  if (!identifier(material.id) || !identifier(material.version) || typeof material.title !== 'string' || typeof material.rights !== 'string'
    || !Array.isArray(material.cues) || !material.cues.length) throw badRecord();
  const ids = new Set<string>();
  for (const raw of material.cues) {
    const cue = record(raw);
    if (!identifier(cue.id) || ids.has(cue.id) || typeof cue.text !== 'string' || typeof cue.start !== 'number' || typeof cue.end !== 'number'
      || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) throw badRecord('参考句标识或时间范围无效。');
    ids.add(cue.id);
  }
}
function editedCue(cue: LocalReferenceCue, duration: number): void {
  if (!cue.text.trim() || !/[a-z0-9]/i.test(cue.text.normalize('NFKC')) || cue.text.length > 8000
    || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > duration) {
    throw new LocalReferenceError('invalid-edit', '请输入可评分英文参考，并满足 0 ≤ 开始 < 结束 ≤ 已核验原片实际时长。');
  }
}
/** Synchronous additive validation only. Legacy absence intentionally remains untouched.
 * This proves declared shape, never a library row, actual media lease or its bytes. */
export function validateOptionalLocalReference(material: unknown): void {
  if (!material || typeof material !== 'object') return;
  const descriptor = Object.getOwnPropertyDescriptor(material, 'localReference');
  if (!descriptor) return;
  if (!Object.hasOwn(descriptor, 'value')) throw badRecord();
  const metadata = binding(descriptor.value);
  materialShape(material); canonicalLocalReferenceJSON(material);
  if (material.id !== 'cafe-original' || material.version === 'cafe-studio-v1' || material.version === metadata.parentVersion) throw badRecord('校正版素材身份无效。');
  const cue = material.cues.find(item => item.id === metadata.editedCueId);
  if (!cue) throw badRecord('校正句不属于此素材。');
  editedCue(cue, metadata.media.durationSeconds);
  if (metadata.lineage) {
    for (const id of metadata.lineage.unitIds) {
      const child = material.cues.find(item => item.id === id);
      if (!child || metadata.lineage.parentUnitIds.some(parentId => material.cues.some(item => item.id === parentId))) throw badRecord('新句谱系与素材不一致。');
      editedCue(child, metadata.media.durationSeconds);
    }
  }
}
export function localReferenceKey(materialId: string, version: string): string {
  if (!identifier(materialId) || !identifier(version)) throw badRecord('参考版本标识无效。');
  return JSON.stringify([materialId, version]);
}
export function captureOriginalReference(original: LocalReferenceMaterial): LocalReferenceMaterial {
  const captured = captureLocalReference(original); materialShape(captured);
  if (captured.id !== 'cafe-original' || captured.version !== 'cafe-studio-v1' || Object.hasOwn(captured, 'localReference')) throw new LocalReferenceError('stale-reference', '本批校正仅接受完整内置咖啡馆原版作为根版本。');
  return captured;
}
function same(a: unknown, b: unknown): boolean { return canonicalLocalReferenceJSON(a) === canonicalLocalReferenceJSON(b); }
function assertParent(parent: LocalReferenceMaterial, original: LocalReferenceMaterial): void {
  materialShape(parent);
  if (parent.id !== original.id) throw new LocalReferenceError('stale-reference', '父版本不属于原版素材。');
  if (!Object.hasOwn(parent, 'localReference')) {
    if (!same(parent, original)) throw new LocalReferenceError('stale-reference', '无来源封装的父版本不是完整原版，不能补造来源。');
  } else validateOptionalLocalReference(parent);
}
function assertDelta(material: LocalReferenceMaterial, parent: LocalReferenceMaterial): void {
  const metadata = material.localReference!;
  if (material.id !== parent.id || material.version === parent.version || metadata.parentVersion !== parent.version) throw new LocalReferenceError('stale-reference', '新参考与父版本的身份不一致。');
  if (parent.localReference && !same(metadata.media, parent.localReference.media)) throw new LocalReferenceError('stale-reference', '同一参考链的原片身份或实际时长发生变化。');
  if (metadata.version === 'local-reference-v2') { assertStructureDelta(material, parent); return; }
  if (material.cues.length !== parent.cues.length) throw new LocalReferenceError('stale-reference', '文字校正不能改变句数。');
  let changed = false;
  for (let index = 0; index < parent.cues.length; index++) {
    const before = parent.cues[index], after = material.cues[index];
    if (before.id !== after.id) throw new LocalReferenceError('invalid-edit', '校正不能重排或改变句子的稳定标识。');
    if (before.id === metadata.editedCueId) {
      const allowed = { ...before, text: after.text, start: after.start, end: after.end };
      if (!same(allowed, after)) throw new LocalReferenceError('invalid-edit', '当前句只能校正文字和起止时间。');
      changed = before.text !== after.text || before.start !== after.start || before.end !== after.end;
    } else if (!same(before, after)) throw new LocalReferenceError('invalid-edit', '不能同时修改其他参考句。');
  }
  if (!changed) throw new LocalReferenceError('no-change', '参考文字和时间没有变化，不创建新版本。');
  const allowed = { ...parent, version: material.version, cues: material.cues, localReference: metadata };
  if (!same(allowed, material)) throw new LocalReferenceError('invalid-edit', '校正不能改变素材的其他内容或元数据。');
}
/** New structural IDs are namespaced by the immutable version, never recycled parent IDs. */
function structureUnitId(version: string, index: number): string { return `unit:${version}:${index + 1}`; }
function assertStructureDelta(material: LocalReferenceMaterial, parent: LocalReferenceMaterial): void {
  const metadata = material.localReference!, lineage = metadata.lineage!;
  const index = parent.cues.findIndex(cue => cue.id === lineage.parentUnitIds[0]);
  if (index < 0) throw badRecord('结构编辑的父句缺失。');
  const before = parent.cues.slice(index, index + lineage.parentUnitIds.length);
  const after = material.cues.slice(index, index + lineage.unitIds.length);
  if (!same(before.map(cue => cue.id), lineage.parentUnitIds) || !same(after.map(cue => cue.id), lineage.unitIds)
    || !same(lineage.unitIds, lineage.unitIds.map((_, i) => structureUnitId(material.version, i)))
    || lineage.unitIds.some(id => parent.cues.some(cue => cue.id === id))
    || material.cues.length !== parent.cues.length - before.length + after.length
    || !same(material.cues.slice(0, index), parent.cues.slice(0, index))
    || !same(material.cues.slice(index + after.length), parent.cues.slice(index + before.length))) throw badRecord('结构编辑不能重用旧标识、重排或改动无关句子。');
  for (const cue of before) {
    editedCue(cue, metadata.media.durationSeconds);
    if (!same(cue, { id: cue.id, text: cue.text, start: cue.start, end: cue.end })) throw new LocalReferenceError('invalid-edit', '父句含有附加元数据，尚不能安全合并或拆分；请保留原句。');
  }
  for (const cue of after) {
    editedCue(cue, metadata.media.durationSeconds);
    // Derived units do not inherit a translation, word timing or speaker metadata
    // whose old per-unit meaning is no longer established after restructuring.
    if (!same(cue, { id: cue.id, text: cue.text, start: cue.start, end: cue.end })) throw badRecord('新句不能沿用未经校验的旧句附加元数据。');
  }
  const left = parent.cues[index - 1], right = parent.cues[index + before.length];
  if (after[0].start !== before[0].start || after.at(-1)!.end !== before.at(-1)!.end
    || (left && after[0].start < left.end) || (right && after.at(-1)!.end > right.start)
    || (lineage.operation === 'merge' && before[0].end > before[1].start)
    || (lineage.operation === 'split' && after[0].end !== after[1].start)) throw new LocalReferenceError('invalid-edit', '合并或拆分必须保留原范围，分界连续且不能与相邻句重叠。');
  const allowed = { ...parent, version: material.version, cues: material.cues, localReference: metadata };
  if (!same(allowed, material)) throw badRecord('结构编辑不能改变素材元数据。');
}
export interface BuildLocalReferenceStructureOptions {
  readonly parent: LocalReferenceMaterial; readonly original: LocalReferenceMaterial; readonly editedCueId: string;
  readonly operation: 'merge' | 'split'; readonly text: string; readonly secondText?: string; readonly splitAt?: number;
  readonly media: LocalReferenceMedia; readonly saveRequestId: string; readonly version?: string; readonly createdAt?: string;
}
export async function buildLocalReferenceStructureProposal(options: BuildLocalReferenceStructureOptions, digest: LocalReferenceDigest = defaultLocalReferenceDigest): Promise<LocalReferenceProposal> {
  const captured = captureLocalReference(options), original = captureOriginalReference(captured.original), parent = captured.parent;
  assertParent(parent, original); validateMedia(captured.media);
  if (!identifier(captured.saveRequestId) || (captured.operation !== 'merge' && captured.operation !== 'split')) throw badRecord('结构编辑请求无效。');
  const version = captured.version ?? `local-ref:${captured.saveRequestId}`, index = parent.cues.findIndex(cue => cue.id === captured.editedCueId);
  const count = captured.operation === 'merge' ? 2 : 1;
  if (index < 0 || index + count > parent.cues.length) throw new LocalReferenceError('invalid-edit', '合并需要当前句及紧随其后的同素材句子。');
  const before = parent.cues.slice(index, index + count);
  const after: LocalReferenceCue[] = captured.operation === 'merge'
    ? [{ id: structureUnitId(version, 0), text: captured.text, start: before[0].start, end: before[1].end }]
    : [{ id: structureUnitId(version, 0), text: captured.text, start: before[0].start, end: captured.splitAt! },
       { id: structureUnitId(version, 1), text: captured.secondText!, start: captured.splitAt!, end: before[0].end }];
  const material: LocalReferenceMaterial = { ...parent, version, cues: [...parent.cues.slice(0, index), ...after, ...parent.cues.slice(index + count)],
    localReference: { version: 'local-reference-v2', trackId: LOCAL_REFERENCE_TRACK_ID, language: 'en', parentVersion: parent.version,
      editedCueId: after[0].id, media: captured.media, lineage: { operation: captured.operation, parentUnitIds: before.map(cue => cue.id), unitIds: after.map(cue => cue.id) } } };
  validateOptionalLocalReference(material); assertDelta(material, parent);
  const unsigned = { schemaVersion: LOCAL_REFERENCE_SCHEMA_VERSION, key: localReferenceKey(material.id, material.version), saveRequestId: captured.saveRequestId,
    material, materialDigest: await canonicalMaterialDigest(material, digest), parent: { materialId: parent.id, version: parent.version, digest: await canonicalMaterialDigest(parent, digest) },
    change: { cueId: after[0].id, before: before[0], after: after[0] }, createdAt: captured.createdAt ?? new Date().toISOString() };
  return validateLocalReferenceReceipt({ ...unsigned, receiptDigest: await digestValue(unsigned, digest) }, parent, original, digest);
}
export interface BuildLocalReferenceOptions {
  readonly parent: LocalReferenceMaterial; readonly original: LocalReferenceMaterial; readonly editedCueId: string;
  readonly text: string; readonly start: number; readonly end: number; readonly media: LocalReferenceMedia;
  readonly saveRequestId: string; readonly version?: string; readonly createdAt?: string;
}
/** Host must supply media from its active verified lease and real loaded duration.
 * No fallback duration, filename inference, clipping, rounding or text normalization. */
export async function buildLocalReferenceProposal(options: BuildLocalReferenceOptions, digest: LocalReferenceDigest = defaultLocalReferenceDigest): Promise<LocalReferenceProposal> {
  const captured = captureLocalReference(options), original = captureOriginalReference(captured.original), parent = captured.parent;
  assertParent(parent, original); validateMedia(captured.media);
  if (!identifier(captured.saveRequestId)) throw badRecord('保存请求标识无效。');
  const version = captured.version ?? `local-ref:${captured.saveRequestId}`;
  const before = parent.cues.find(cue => cue.id === captured.editedCueId);
  if (!before) throw new LocalReferenceError('invalid-edit', '当前校正句不存在。');
  const after = { ...before, text: captured.text, start: captured.start, end: captured.end };
  const material: LocalReferenceMaterial = { ...parent, version, cues: parent.cues.map(cue => cue.id === before.id ? after : cue),
    localReference: { version: 'local-reference-v1', trackId: LOCAL_REFERENCE_TRACK_ID, language: 'en', parentVersion: parent.version,
      editedCueId: before.id, media: captured.media } };
  validateOptionalLocalReference(material); assertDelta(material, parent);
  const unsigned = { schemaVersion: LOCAL_REFERENCE_SCHEMA_VERSION, key: localReferenceKey(material.id, material.version), saveRequestId: captured.saveRequestId,
    material, materialDigest: await canonicalMaterialDigest(material, digest),
    parent: { materialId: parent.id, version: parent.version, digest: await canonicalMaterialDigest(parent, digest) },
    change: { cueId: before.id, before, after }, createdAt: captured.createdAt ?? new Date().toISOString() };
  const result = { ...unsigned, receiptDigest: await digestValue(unsigned, digest) };
  return validateLocalReferenceReceipt(result, parent, original, digest);
}
const receiptKeys = ['schemaVersion', 'key', 'saveRequestId', 'material', 'materialDigest', 'parent', 'change', 'createdAt', 'receiptDigest'];
/** Narrow envelope validation, with whole Material and cue metadata retained. */
export function captureLocalReferenceReceipt(value: unknown): LocalReferenceReceipt {
  const data = exact(value, receiptKeys), parent = exact(data.parent, ['materialId', 'version', 'digest']), change = exact(data.change, ['cueId', 'before', 'after']);
  if (data.schemaVersion !== LOCAL_REFERENCE_SCHEMA_VERSION || !identifier(data.saveRequestId) || typeof data.materialDigest !== 'string' || !hashPattern.test(data.materialDigest)
    || typeof data.receiptDigest !== 'string' || !hashPattern.test(data.receiptDigest) || !identifier(parent.materialId) || !identifier(parent.version)
    || typeof parent.digest !== 'string' || !hashPattern.test(parent.digest) || !identifier(change.cueId)
    || typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt)) || new Date(data.createdAt).toISOString() !== data.createdAt) throw badRecord();
  materialShape(data.material); validateOptionalLocalReference(data.material);
  const material = data.material;
  if (!material.localReference || data.key !== localReferenceKey(material.id, material.version)
    || parent.materialId !== material.id || parent.version !== material.localReference.parentVersion || change.cueId !== material.localReference.editedCueId) throw badRecord('参考回执与嵌入素材身份不一致。');
  return captureLocalReference(value) as LocalReferenceReceipt;
}
export async function validateLocalReferenceReceipt(value: unknown, parent: LocalReferenceMaterial, original: LocalReferenceMaterial,
  digest: LocalReferenceDigest = defaultLocalReferenceDigest): Promise<LocalReferenceReceipt> {
  const row = captureLocalReferenceReceipt(value);
  assertParent(parent, original); assertDelta(row.material, parent);
  const before = parent.cues.find(cue => cue.id === (row.material.localReference?.lineage?.parentUnitIds[0] ?? row.change.cueId)), after = row.material.cues.find(cue => cue.id === row.change.cueId);
  if (row.parent.materialId !== parent.id || row.parent.version !== parent.version || !same(row.change.before, before) || !same(row.change.after, after)) throw badRecord('参考的父版本或前后校正内容不一致。');
  const { receiptDigest, ...unsigned } = row;
  if (row.parent.digest !== await canonicalMaterialDigest(parent, digest) || row.materialDigest !== await canonicalMaterialDigest(row.material, digest)
    || receiptDigest !== await digestValue(unsigned, digest)) throw badRecord('完整参考或父版本摘要不一致，未采用此版本。');
  return row;
}
/** Creation time belongs to the first receipt, not a retried save request. */
export function sameLocalReferenceSaveIntent(a: LocalReferenceReceipt, b: LocalReferenceReceipt): boolean {
  const { createdAt: _a, receiptDigest: _ad, ...left } = a;
  const { createdAt: _b, receiptDigest: _bd, ...right } = b;
  return same(left, right);
}
