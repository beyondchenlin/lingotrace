/** Decorative video-derived colours only. Never use these for text or semantic feedback. */
export type PaletteMode = 'off' | 'frame' | 'follow';
export type VideoPalette = Readonly<{
  frame: string;
  glassTop: string;
  glassBottom: string;
  glow: string;
}>;
export type VideoPaletteStatus = 'off' | 'waiting' | 'active' | 'paused' | 'locked' | 'unavailable';
export type VideoPaletteState = Readonly<{
  mode: PaletteMode;
  status: VideoPaletteStatus;
  locked: boolean;
  hasPalette: boolean;
  message: string;
}>;
export const INITIAL_VIDEO_PALETTE_STATE: VideoPaletteState = Object.freeze({
  mode: 'off', status: 'off', locked: false, hasPalette: false,
  message: '已关闭，使用默认配色。',
});

export type VideoPaletteTone = Readonly<{ hue: number; saturation: number; lightness: number; luminance: number }>;
export type VideoPaletteAnalysis = Readonly<{
  tone: VideoPaletteTone | null;
  reason: 'color' | 'black' | 'white' | 'empty';
}>;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const channel = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
export function videoPaletteLuminance(red: number, green: number, blue: number): number {
  return .2126 * channel(red / 255) + .7152 * channel(green / 255) + .0722 * channel(blue / 255);
}

/** A strict renderer boundary: canonical hex only, and glass can never become a bright panel. */
export function validateVideoPalette(value: unknown): value is VideoPalette {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const limits = { frame: [.46, 220], glassTop: [.035, 64], glassBottom: [.012, 40], glow: [.60, 235] } as const;
    return (Object.keys(limits) as (keyof VideoPalette)[]).every(key => {
      const color = (value as VideoPalette)[key];
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/.test(color)) return false;
      const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
      return Math.max(r, g, b) <= limits[key][1] && videoPaletteLuminance(r, g, b) <= limits[key][0];
    });
  } catch { return false; }
}

/**
 * O(width*height), intended for 96x54 RGBA, never a display/recording canvas.
 * Crop contiguous almost-black edges, and give the lower subtitle region 15% weight.
 * Pure chromatic frames are valid even when their perceptual luminance is low.
 */
export function analyzeVideoPalette(
  pixels: ArrayLike<number>, width: number, height: number, previousHue = 210,
): VideoPaletteAnalysis {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 65536 || pixels.length < width * height * 4) return { tone: null, reason: 'empty' };
  const isBlack = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return pixels[i + 3] < 128 || Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 20;
  };
  const darkRow = (y: number, left: number, right: number) => {
    let dark = 0;
    for (let x = left; x < right; x++) if (isBlack(x, y)) dark++;
    return dark / (right - left) >= .97;
  };
  const darkColumn = (x: number, top: number, bottom: number) => {
    let dark = 0;
    for (let y = top; y < bottom; y++) if (isBlack(x, y)) dark++;
    return dark / (bottom - top) >= .97;
  };
  let left = 0, top = 0, right = width, bottom = height;
  while (top < height * .4 && darkRow(top, left, right)) top++;
  while (bottom > height * .6 && darkRow(bottom - 1, left, right)) bottom--;
  while (left < width * .4 && darkColumn(left, top, bottom)) left++;
  while (right > width * .6 && darkColumn(right - 1, top, bottom)) right--;
  const bins = new Float64Array(24);
  const hueX = new Float64Array(24), hueY = new Float64Array(24);
  let weight = 0, transparent = 0, black = 0, white = 0, considered = 0;
  let saturation = 0, lightness = 0, luminance = 0, coloredWeight = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const i = (y * width + x) * 4;
    if (pixels[i + 3] < 128) { transparent++; continue; }
    considered++;
    const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
    if (max < 20 / 255) { black++; continue; }
    if (min > 240 / 255 && chroma < .075) { white++; continue; }
    const w = (y - top) / (bottom - top) >= .78 ? .15 : 1;
    const l = (max + min) / 2;
    const s = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * l - 1));
    weight += w;
    saturation += s * w;
    lightness += l * w;
    luminance += videoPaletteLuminance(pixels[i], pixels[i + 1], pixels[i + 2]) * w;
    if (chroma < .07 || s < .12) continue;
    let h = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
    h = (h * 60 + 360) % 360;
    const bin = Math.floor(h / 15), strength = w * chroma;
    bins[bin] += strength;
    hueX[bin] += Math.cos(h * Math.PI / 180) * strength;
    hueY[bin] += Math.sin(h * Math.PI / 180) * strength;
    coloredWeight += strength;
  }
  if (!considered || transparent === (right - left) * (bottom - top)) return { tone: null, reason: 'empty' };
  // Reject near-white flashes as a whole, retaining the previous palette in the caller.
  if (white / considered > .8) return { tone: null, reason: 'white' };
  if (!weight || black / considered > .97) return { tone: null, reason: 'black' };
  let hue = Number.isFinite(previousHue) ? (previousHue % 360 + 360) % 360 : 210;
  if (coloredWeight / weight >= .055) {
    let best = 0;
    for (let bin = 1; bin < 24; bin++) if (bins[bin] > bins[best]) best = bin;
    const before = (best + 23) % 24, after = (best + 1) % 24;
    const x = hueX[best] + hueX[before] + hueX[after], y = hueY[best] + hueY[before] + hueY[after];
    hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  return { reason: 'color', tone: Object.freeze({ hue, saturation: saturation / weight,
    lightness: lightness / weight, luminance: luminance / weight }) };
}

/** ~600ms ordinary smoothing, ~250ms scene cuts, with a per-sample luminance/lightness clamp. */
export function smoothVideoPaletteTone(previous: VideoPaletteTone | null, target: VideoPaletteTone, elapsedMs = 125): VideoPaletteTone {
  if (!previous) return Object.freeze({ ...target });
  const hueDelta = ((target.hue - previous.hue + 540) % 360) - 180;
  const cut = Math.abs(hueDelta) >= 65 || Math.abs(target.luminance - previous.luminance) > .3;
  // A long suspension must not result in a hard jump on resumption.
  const dt = Number.isFinite(elapsedMs) ? clamp(elapsedMs, 0, 250) : 125;
  const amount = 1 - Math.exp(-dt / (cut ? 250 : 600));
  return Object.freeze({
    hue: (previous.hue + hueDelta * amount + 360) % 360,
    saturation: previous.saturation + (target.saturation - previous.saturation) * amount,
    lightness: previous.lightness + clamp((target.lightness - previous.lightness) * amount, -.045, .045),
    luminance: previous.luminance + clamp((target.luminance - previous.luminance) * amount, -.045, .045),
  });
}

function hexHsl(hue: number, saturation: number, lightness: number, maxLuminance: number, maxChannel: number): string {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const h = hue / 60, x = c * (1 - Math.abs(h % 2 - 1)), m = lightness - c / 2;
  const rgb = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  let channels = rgb.map(v => Math.round((v + m) * 255));
  // Yellow/green have higher luminance than equally light blue. Clamp the actual
  // sRGB output rather than loosening the renderer's contrast boundary.
  while (Math.max(...channels) > maxChannel || videoPaletteLuminance(channels[0], channels[1], channels[2]) > maxLuminance) {
    channels = channels.map(value => Math.floor(value * .98));
  }
  return '#' + channels.map(value => value.toString(16).padStart(2, '0')).join('');
}

export function createVideoPalette(tone: VideoPaletteTone): VideoPalette {
  const hue = Number.isFinite(tone.hue) ? (tone.hue % 360 + 360) % 360 : 210;
  const saturation = Number.isFinite(tone.saturation) ? clamp(tone.saturation, 0, 1) : 0;
  const brightness = Number.isFinite(tone.lightness) ? clamp(tone.lightness, 0, 1) : .5;
  return Object.freeze({
    frame: hexHsl(hue, .20 + saturation * .30, .38 + brightness * .12, .46, 220),
    glassTop: hexHsl(hue, .12 + saturation * .25, .085 + brightness * .04, .035, 64),
    glassBottom: hexHsl(hue, .10 + saturation * .20, .035 + brightness * .025, .012, 40),
    glow: hexHsl(hue, .20 + saturation * .28, .48 + brightness * .12, .60, 235),
  });
}
