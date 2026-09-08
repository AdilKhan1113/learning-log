/**
 * Design tokens.
 *
 * Spacing is generous and tap targets are large, both because the brief asks
 * and because the app is used one-handed, often while holding something else.
 */
import { palette } from './colors.ts';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 44, fontWeight: '700', letterSpacing: -1 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 19, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  label: { fontSize: 14, fontWeight: '500' },
  caption: { fontSize: 13, fontWeight: '400' },
} as const;

/** Minimum tap target. Below this, things get missed on the move. */
export const HIT_SIZE = 48;

export const theme = {
  colors: palette,
  spacing,
  radius,
  typography,
  hitSize: HIT_SIZE,
} as const;

export type Theme = typeof theme;
export { palette } from './colors.ts';
export { macroColors } from './colors.ts';
