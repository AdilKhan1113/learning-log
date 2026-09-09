/**
 * Bars for period averages — one value per period, or a stack of macros.
 *
 * Stacked segments carry a 2px surface-coloured gap between them so the
 * boundary reads as a boundary rather than as a colour change, and so the
 * segments stay separable in greyscale or with colour vision deficiency.
 *
 * A stack always ships with a legend, and tapping a bar reveals its numbers;
 * no bar is labelled with a number by default.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text.tsx';
import { palette, radius, spacing } from '../theme/index.ts';

export interface BarSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface BarDatum {
  label: string;
  /** One segment for a plain bar, several to stack them. */
  segments: BarSegment[];
  /** Shown when the bar is tapped. */
  detail: string;
}

export interface BarChartProps {
  data: readonly BarDatum[];
  height?: number;
  /** Legend entries. Required whenever bars have more than one segment. */
  legend?: { label: string; color: string }[];
}

/** Rounded ends on the data end only; the baseline end stays square. */
const CORNER = 4;
const SEGMENT_GAP = 2;
const MIN_BAR_WIDTH = 14;
const MAX_BAR_WIDTH = 44;

export function BarChart({ data, height = 160, legend }: BarChartProps) {
  const [selected, setSelected] = useState<number | null>(null);
  if (data.length === 0) return null;

  const totals = data.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0));
  const max = Math.max(...totals, 1);

  return (
    <View style={{ gap: spacing.md }}>
      {legend && legend.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' }}>
          {legend.map((entry) => (
            <View
              key={entry.label}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  backgroundColor: entry.color,
                }}
              />
              {/* Legend text stays in ink, never the series colour. */}
              <Text variant="caption" color={palette.textSecondary}>
                {entry.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-around',
          height,
          gap: spacing.sm,
        }}
      >
        {data.map((datum, index) => {
          const total = totals[index]!;
          const barHeight = Math.max(2, (total / max) * (height - 24));
          const isSelected = selected === index;

          return (
            <Pressable
              key={datum.label + index}
              accessibilityRole="button"
              accessibilityLabel={`${datum.label}: ${datum.detail}`}
              onPress={() => setSelected(isSelected ? null : index)}
              style={{
                flex: 1,
                minWidth: MIN_BAR_WIDTH,
                maxWidth: MAX_BAR_WIDTH,
                alignItems: 'center',
                gap: spacing.xs,
                opacity: selected === null || isSelected ? 1 : 0.55,
              }}
            >
              <View
                style={{
                  width: '100%',
                  height: barHeight,
                  justifyContent: 'flex-end',
                  borderTopLeftRadius: CORNER,
                  borderTopRightRadius: CORNER,
                  overflow: 'hidden',
                }}
              >
                {/* Drawn bottom-up so the first segment sits on the baseline. */}
                {[...datum.segments].reverse().map((segment, segmentIndex) => (
                  <View
                    key={segment.key}
                    style={{
                      height: `${(segment.value / (total || 1)) * 100}%`,
                      backgroundColor: segment.color,
                      marginTop:
                        segmentIndex > 0 && datum.segments.length > 1 ? SEGMENT_GAP : 0,
                    }}
                  />
                ))}
              </View>
              <Text variant="caption" color={palette.textTertiary}>
                {datum.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {selected !== null ? (
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            borderRadius: radius.sm,
            backgroundColor: palette.surfaceRaised,
          }}
        >
          <Text variant="caption" color={palette.textSecondary}>
            {data[selected]?.label} · {data[selected]?.detail}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
