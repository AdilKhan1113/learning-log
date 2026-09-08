/**
 * Palette. Dark by default, as the brief asks.
 *
 * Calm rather than clinical: a soft near-black ground rather than pure #000,
 * desaturated surfaces, and one warm accent. The macro colours are chosen to
 * stay distinguishable for the common forms of colour blindness — they differ
 * in lightness as well as hue, so the macro bars are readable even if the hues
 * are not.
 *
 * Nothing here encodes judgement. There is no "over budget red": passing a
 * target changes a number, not a colour.
 */

export const palette = {
  // Ground and surfaces
  background: '#12131A',
  surface: '#1B1D26',
  surfaceRaised: '#242733',
  border: '#2E3240',

  // Text
  text: '#F2F3F7',
  textSecondary: '#A5A9B8',
  textTertiary: '#6E7385',

  // Accent
  accent: '#7BE0AD',
  accentMuted: '#2A4A3E',
  accentText: '#0C1B15',

  // Macros
  protein: '#8AB4F8',
  carbs: '#F5C97B',
  fat: '#D89BE0',
  water: '#7BC4E0',

  // Neutral track behind any progress indicator
  track: '#2A2D3A',

  /**
   * Used only for genuine errors — a failed lookup, a denied permission.
   * Never for a nutrition value.
   */
  error: '#F2A2A2',
  errorSurface: '#3A2428',
} as const;

export type Palette = typeof palette;

export const macroColors = {
  protein: palette.protein,
  carbs: palette.carbs,
  fat: palette.fat,
} as const;
