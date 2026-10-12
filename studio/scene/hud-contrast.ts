/** Local, presentation-only contrast. Never sample the display or recording canvas. */
export type HudContrastRegion = Readonly<{ x: number; y: number; w: number; h: number }>;
export type HudContrastRegions = Readonly<Record<string, HudContrastRegion>>;
export type HudContrastState = Readonly<{
  status: 'adaptive' | 'fallback' | 'waiting';
  alpha: Readonly<Record<string, number>>;
}>;
/** Return regional relative luminance, null while media is unready, or throw if inaccessible. */
export type HudContrastSampler = (
  source: CanvasImageSource, regions: HudContrastRegions,
) => Readonly<Record<string, number>> | null;

export const HUD_CONTRAST_MIN_ALPHA = .30;
export const HUD_CONTRAST_MAX_ALPHA = .78;
export const HUD_CONTRAST_FALLBACK_ALPHA = HUD_CONTRAST_MAX_ALPHA;
export const HUD_CONTRAST_SAMPLE_MS = 250;
export const HUD_CONTRAST_SMOOTHING_MS = 600;
const WIDTH = 96, HEIGHT = 54;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const linearChannel = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;

/** WCAG relative luminance of sRGB channels (0–255). Invalid input fails conservatively. */
export function hudRelativeLuminance(red: number, green: number, blue: number): number {
  if (![red, green, blue].every(Number.isFinite)) return 1;
  return .2126 * linearChannel(clamp(red, 0, 255) / 255) +
    .7152 * linearChannel(clamp(green, 0, 255) / 255) +
    .0722 * linearChannel(clamp(blue, 0, 255) / 255);
}

/** Continuous linear mapping, with no brightness thresholds, quantiles, or mode switching. */
export function hudBackingAlpha(luminance: number): number {
  if (!Number.isFinite(luminance)) return HUD_CONTRAST_FALLBACK_ALPHA;
  return HUD_CONTRAST_MIN_ALPHA + (HUD_CONTRAST_MAX_ALPHA - HUD_CONTRAST_MIN_ALPHA) * clamp(luminance, 0, 1);
}

/** Frame-rate-independent temporal easing, separate from the linear brightness mapping. */
export function smoothHudBackingAlpha(previous: number, target: number, elapsedMs: number): number {
  const from = Number.isFinite(previous) ? clamp(previous, HUD_CONTRAST_MIN_ALPHA, HUD_CONTRAST_MAX_ALPHA) : HUD_CONTRAST_FALLBACK_ALPHA;
  const to = Number.isFinite(target) ? clamp(target, HUD_CONTRAST_MIN_ALPHA, HUD_CONTRAST_MAX_ALPHA) : HUD_CONTRAST_FALLBACK_ALPHA;
  // A suspended tab or seek must not create an instantaneous jump when rendering resumes.
  const elapsed = Number.isFinite(elapsedMs) ? clamp(elapsedMs, 0, HUD_CONTRAST_SAMPLE_MS) : 0;
  return from + (to - from) * (1 - Math.exp(-elapsed / HUD_CONTRAST_SMOOTHING_MS));
}

/**
 * Mean luminance in each source-normalized rectangle. One tiny frame is shared by all
 * regions; no brightest-pixel or light/dark classification changes the linear mapping.
 * Unknown transparent pixels are composited over white, rather than assumed to be dark.
 * Invalid/outside regions are omitted so their caller keeps the readable fallback.
 */
export function analyzeHudLuminance(
  pixels: ArrayLike<number>, width: number, height: number, regions: HudContrastRegions,
): Readonly<Record<string, number>> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 65536 || pixels.length < width * height * 4) return {};
  return Object.fromEntries(Object.entries(regions).flatMap(([key, region]) => {
    if (![region.x, region.y, region.w, region.h].every(Number.isFinite) || region.w <= 0 || region.h <= 0) return [];
    const left = clamp(Math.floor(region.x * width), 0, width);
    const top = clamp(Math.floor(region.y * height), 0, height);
    const right = clamp(Math.ceil((region.x + region.w) * width), 0, width);
    const bottom = clamp(Math.ceil((region.y + region.h) * height), 0, height);
    if (right <= left || bottom <= top) return [];
    let sum = 0;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const index = (y * width + x) * 4;
      const alpha = Number.isFinite(pixels[index + 3]) ? clamp(pixels[index + 3], 0, 255) / 255 : 0;
      sum += hudRelativeLuminance(
        pixels[index] * alpha + 255 * (1 - alpha),
        pixels[index + 1] * alpha + 255 * (1 - alpha),
        pixels[index + 2] * alpha + 255 * (1 - alpha),
      );
    }
    const coverage=clamp((Math.min(1,region.x+region.w)-Math.max(0,region.x))*(Math.min(1,region.y+region.h)-Math.max(0,region.y))/(region.w*region.h),0,1);
    return [[key, sum / ((right - left) * (bottom - top)) * coverage]];
  }));
}

function sourceReady(source: CanvasImageSource): boolean {
  if ('videoWidth' in source) return source.readyState >= 2 && source.videoWidth > 0 && source.videoHeight > 0;
  if ('naturalWidth' in source) return source.complete && source.naturalWidth > 0 && source.naturalHeight > 0;
  if ('displayWidth' in source) return source.displayWidth > 0 && source.displayHeight > 0;
  if (typeof source.width === 'number' && typeof source.height === 'number') return source.width > 0 && source.height > 0;
  // SVG dimensions are animated lengths rather than numeric canvas dimensions.
  return typeof source.width !== 'number' && typeof source.height !== 'number' &&
    source.width.baseVal.value > 0 && source.height.baseVal.value > 0;
}

function createLocalSampler(): HudContrastSampler {
  let surface: HTMLCanvasElement | OffscreenCanvas | null = null;
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  return (source, regions) => {
    if (!sourceReady(source)) return null;
    try {
      if (!surface) {
        if (typeof OffscreenCanvas !== 'undefined') surface = new OffscreenCanvas(WIDTH, HEIGHT);
        else if (typeof document !== 'undefined') {
          surface = document.createElement('canvas');
          surface.width = WIDTH;
          surface.height = HEIGHT;
        }
        if (!surface) throw new Error('Local HUD sampling is unavailable');
        context = surface.getContext('2d', { willReadFrequently: true }) as typeof context;
        if (!context) throw new Error('Local HUD sampling context is unavailable');
      }
      context!.clearRect(0, 0, WIDTH, HEIGHT);
      context!.drawImage(source, 0, 0, WIDTH, HEIGHT);
      return analyzeHudLuminance(context!.getImageData(0, 0, WIDTH, HEIGHT).data, WIDTH, HEIGHT, regions);
    } catch (error) {
      // A CORS-tainted canvas cannot become readable again. Discard only our sampler;
      // the display/recording surface is never accessed, reset, or tainted by this code.
      surface = null;
      context = null;
      throw error;
    }
  };
}

type RegionState = { rect: HudContrastRegion; alpha: number; target: number };
const sameRegion = (a: HudContrastRegion, b: HudContrastRegion) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * Call from the renderer's existing frame loop. No timer, media mutation, storage,
 * network, or training state is involved. The caller supplies a new identity when
 * an existing media element loads different content (including a different camera).
 */
export class HudContrastController {
  private readonly sampler: HudContrastSampler;
  private source: CanvasImageSource | null = null;
  private identity: string | null = null;
  private regions = new Map<string, RegionState>();
  private lastSampleAt = -Infinity;
  private lastUpdateAt: number | null = null;
  private status: HudContrastState['status'] = 'waiting';
  private inaccessible = false;

  constructor(options: { sampler?: HudContrastSampler } = {}) {
    this.sampler = options.sampler ?? createLocalSampler();
  }

  reset(): void {
    this.source = null;
    this.identity = null;
    this.regions.clear();
    this.lastSampleAt = -Infinity;
    this.lastUpdateAt = null;
    this.status = 'waiting';
    this.inaccessible = false;
  }

  update(
    source: CanvasImageSource | null, identity: string, regions: HudContrastRegions,
    now: number, reducedMotion = false,
  ): HudContrastState {
    if (source !== this.source || identity !== this.identity) {
      this.reset();
      this.source = source;
      this.identity = identity;
    }
    const time = Number.isFinite(now) ? now : (this.lastUpdateAt ?? 0);
    const elapsed = this.lastUpdateAt === null ? 0 : Math.max(0, time - this.lastUpdateAt);
    // A rewound presentation clock starts a fresh sampling interval, not a rapid retry loop.
    if (this.lastUpdateAt !== null && time < this.lastUpdateAt) this.lastSampleAt = time;
    this.lastUpdateAt = time;
    for (const key of this.regions.keys()) if (!Object.hasOwn(regions, key)) this.regions.delete(key);
    for (const [key, rect] of Object.entries(regions)) {
      const prior = this.regions.get(key);
      if (!prior || !sameRegion(prior.rect, rect)) {
        this.regions.set(key, { rect: { ...rect }, alpha: HUD_CONTRAST_FALLBACK_ALPHA, target: HUD_CONTRAST_FALLBACK_ALPHA });
        this.status = 'waiting';
      }
    }
    if (!source || !sourceReady(source)) {
      this.lastSampleAt = -Infinity;
      return this.fallback('waiting');
    }
    // Fixed readable backing is deterministic even while the source keeps changing.
    if (reducedMotion) {
      this.lastSampleAt = -Infinity;
      return this.fallback('fallback');
    }
    // Avoid repeated security exceptions and pixel reads on a known-inaccessible source.
    // An explicit reset, changed identity, or changed source permits a fresh attempt.
    if (this.inaccessible) return this.fallback('fallback');
    if (this.regions.size === 0) return this.fallback('waiting');
    if (time - this.lastSampleAt >= HUD_CONTRAST_SAMPLE_MS) {
      this.lastSampleAt = time;
      try {
        const sampled = this.sampler(source, regions);
        if (!sampled) return this.fallback('waiting');
        this.status = 'adaptive';
        for (const [key, state] of this.regions) {
          if (Object.hasOwn(sampled, key) && Number.isFinite(sampled[key])) state.target = hudBackingAlpha(sampled[key]);
          else {
            state.alpha = state.target = HUD_CONTRAST_FALLBACK_ALPHA;
            this.status = 'fallback';
          }
        }
      } catch {
        this.inaccessible = true;
        return this.fallback('fallback');
      }
    }
    for (const state of this.regions.values()) state.alpha = smoothHudBackingAlpha(state.alpha, state.target, elapsed);
    return this.result();
  }

  private fallback(status: HudContrastState['status']): HudContrastState {
    this.status = status;
    for (const state of this.regions.values()) state.alpha = state.target = HUD_CONTRAST_FALLBACK_ALPHA;
    return this.result();
  }

  private result(): HudContrastState {
    return Object.freeze({
      status: this.status,
      alpha: Object.freeze(Object.fromEntries([...this.regions].map(([key, state]) => [key, state.alpha]))),
    });
  }
}
