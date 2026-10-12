/** One explicit recording request owns one set of inputs. Late requests may
 * release their own resources, never another request's microphone or mix. */
export class RecordingPreparationCanceled extends Error {
  constructor() { super('录制准备已取消。'); this.name = 'RecordingPreparationCanceled'; }
}

export class RecordingInputResources {
  private released = false;
  private streams = new Set<MediaStream>();
  private cleanups: (() => void)[] = [];

  assertActive(): void { if (this.released) throw new RecordingPreparationCanceled(); }
  ownStream<T extends MediaStream>(stream: T): T {
    if (this.released) {
      for (const track of stream.getTracks()) {
        try { if (track.readyState !== 'ended') track.stop(); } catch { /* Release other late tracks. */ }
      }
      throw new RecordingPreparationCanceled();
    }
    this.streams.add(stream);
    return stream;
  }
  cleanup(cleanup: () => void): void {
    if (this.released) { cleanup(); throw new RecordingPreparationCanceled(); }
    this.cleanups.push(cleanup);
  }
  release(): void {
    if (this.released) return;
    this.released = true;
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try { cleanup(); } catch { /* Release every other owned resource too. */ }
    }
    for (const stream of this.streams) for (const track of stream.getTracks()) {
      try { if (track.readyState !== 'ended') track.stop(); } catch { /* Continue release. */ }
    }
    this.streams.clear();
  }
}
