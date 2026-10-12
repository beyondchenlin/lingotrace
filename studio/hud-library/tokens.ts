import type { HudColors, HudStyle, HudTypography } from './schema.ts';
export const HUD_COLORS: HudColors = Object.freeze({
  text: '#edf4f1', muted: '#93a6a6', accent: '#b8f16b', accentSoft: '#345341',
  track: '#233233', guide: '#334448', warning: '#e8bc76', error: '#f29389',
});
export const HUD_FONT: HudTypography = Object.freeze({
  family: 'Arial, sans-serif', numericFamily: '"Courier New", monospace', labelSize: 11, valueSize: 48,
});
export const HUD_SPACING = Object.freeze({ inset: 18, label: 12, gap: 8, lineWidth: 1, accentWidth: 2 });
export function resolveStyle(style?: HudStyle): Readonly<{ colors: HudColors; font: HudTypography; opacity: number }> {
  return { colors: { ...HUD_COLORS, ...style?.colors }, font: { ...HUD_FONT, ...style?.font }, opacity: style?.opacity ?? 1 };
}
