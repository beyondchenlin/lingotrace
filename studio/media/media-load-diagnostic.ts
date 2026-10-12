/** Small local-only diagnostics; never transmit them or include source URLs.
 * Native codes and a bounded sanitized message distinguish parser/decoder faults. */
export function reviewMediaDiagnostic(stage: 'metadata' | 'lesson' | 'playback', video: {
  error?: { code: number; message?: string } | null; readyState?: number; networkState?: number;
}): string {
  const code = Number.isInteger(video.error?.code) ? video.error!.code : 0;
  const ready = Number.isInteger(video.readyState) ? video.readyState : -1;
  const network = Number.isInteger(video.networkState) ? video.networkState : -1;
  let detail = '';
  try {
    if (typeof video.error?.message === 'string') detail = video.error.message
      .replace(/(?:https?|blob|file|data):\S+/gi, '[source]')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  } catch { /* A native message is optional, never a reason to mask the code. */ }
  return `[${stage}; MEDIA_${code}; ready=${ready}; network=${network}${detail ? `; detail=${detail}` : ''}]`;
}

/** Only finite numeric timing data; no source URL, answer or raw error text. */
export function reviewDurationDiagnostic(actual: number, expected: number, tolerance: number): string {
  const finite = (value: number) => Number.isFinite(value) ? String(value) : 'unknown';
  return `[duration; actual=${finite(actual)}; expected=${finite(expected)}; tolerance=${finite(tolerance)}]`;
}

/** Bounded local timing facts, including native pending-duration sentinels.
 * Transport is an allowlisted label, never a source URL or caller error text. */
export function reviewRangeDiagnostic(actual: number, start: number, end: number, transport: string, ready?: number): string {
  const number = (value: number) => Number.isFinite(value) ? String(value) :
    Number.isNaN(value) ? 'NaN' : value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : 'unknown';
  const kind = transport === 'blob' || transport === 'verified-direct' ? transport : 'unknown';
  return `[range-v71; actual=${number(actual)}; cueStart=${number(start)}; cueEnd=${number(end)}; ready=${Number.isInteger(ready) ? ready : -1}; transport=${kind}]`;
}

/** A primitive-only snapshot taken before blob() consumes the response. Reading
 * these properties never clones, locks, cancels or consumes a native body. */
export type BodyReadDiagnostic = Readonly<{
  used: boolean | 'unknown'; locked: boolean | 'unknown';
  status: number | 'unknown'; length: number | 'unknown';
  encoding: 'none' | 'unknown' | 'identity' | 'gzip' | 'deflate' | 'br' | 'zstd' | 'other';
}>;
const optionalDiagnosticValue = <T>(read: () => T): T | undefined => {
  try { return read(); } catch { return undefined; }
};
export function captureBodyReadDiagnostic(response: Partial<Pick<Response, 'bodyUsed' | 'body' | 'status' | 'headers'>>): BodyReadDiagnostic {
  const used = optionalDiagnosticValue(() => response.bodyUsed);
  const locked = optionalDiagnosticValue(() => response.body?.locked);
  const status = optionalDiagnosticValue(() => response.status);
  const length = optionalDiagnosticValue(() => response.headers?.get('content-length'));
  const encoding = optionalDiagnosticValue(() => response.headers?.get('content-encoding'));
  const numericLength = typeof length === 'string' && /^[0-9]{1,16}$/.test(length) ? Number(length) : NaN;
  const normalizedEncoding = typeof encoding === 'string' && encoding.length <= 16 ? encoding.trim().toLowerCase() : encoding;
  return Object.freeze({
    used: typeof used === 'boolean' ? used : 'unknown',
    locked: typeof locked === 'boolean' ? locked : 'unknown',
    status: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'unknown',
    length: Number.isSafeInteger(numericLength) ? numericLength : 'unknown',
    encoding: encoding === null ? 'none' : encoding === undefined ? 'unknown' :
      normalizedEncoding === 'identity' || normalizedEncoding === 'gzip' || normalizedEncoding === 'deflate' ||
      normalizedEncoding === 'br' || normalizedEncoding === 'zstd' ? normalizedEncoding : 'other',
  });
}

/** Local error detail only. Never read/stringify message, stack, cause, URL,
 * cookies, arbitrary headers or input. These labels do not authorize playback. */
export function reviewBodyReadDiagnostic(error: unknown, aborted: boolean, before: BodyReadDiagnostic): string {
  const name = optionalDiagnosticValue(() => (error as { name?: unknown } | null)?.name);
  const kind = name === 'TypeError' || name === 'AbortError' || name === 'RangeError' ? name : 'other';
  return `[body-v1; kind=${kind}; aborted=${aborted === true}; used=${before.used}; locked=${before.locked}; status=${before.status}; length=${before.length}; encoding=${before.encoding}]`;
}
