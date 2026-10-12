import type { RecordMeta, SceneRecordingStore } from './scene-recorder';

/** Types for the verified existing recording-storage.js adapter; no replacement implementation. */
export declare class IndexedDBRecordingStore implements SceneRecordingStore {
  constructor(config?: { dbName?: string; indexedDB?: IDBFactory; IDBKeyRange?: typeof IDBKeyRange });
  open(): Promise<void>;
  probe(): Promise<void>;
  list(): Promise<RecordMeta[]>;
  get(id: string): Promise<RecordMeta | null>;
  create(meta: RecordMeta): Promise<RecordMeta>;
  update(id: string, mutate: (old: RecordMeta) => RecordMeta): Promise<RecordMeta>;
  append(id: string, sequence: number, chunk: Blob, committedAt: number): Promise<RecordMeta>;
  remove(id: string, options?: { expiredAt?: number }): Promise<boolean>;
  readChunks(id: string, maxBytes: number): Promise<BlobPart[]>;
  close(): void;
}
export declare function selectRecordingMime(Recorder: typeof MediaRecorder, withAudio: boolean): string;
export declare function recordingExtension(mimeType: string): string;
