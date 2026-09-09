/**
 * A single-series line chart with an optional smoothed line through it.
 *
 * One series, so no legend — the title above it names what is plotted. Raw
 * points sit behind at low opacity and the trend line is what the eye follows,
 * which is the honest emphasis for weight: the daily number is mostly water.
 *
 * Tapping a point reveals its value rather than labelling every one.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Text } from './Text.tsx';
import { palette, radius, spacing } from '../theme/index.ts';

export interface LinePoint {
  label: string;
  value: number;
}

export interface LineChartProps {
  points: readonly LinePoint[];
  /** Smoothed series, drawn as the emphasised line. Same length as `points`. */
  trend?: readonly LinePoint[];
  height?: number;
  color?: string;
  /** Rendered beside a tapped point, e.g. "81.2 kg". */
  formatValue?: (value: number) => string;
}

/** Marks are 2px; anything thinner disappears on a dark background. */
const STROKE = 2;
const DOT_RADIUS = 3;
const TAP_RADIUS = 9;
const PADDING = { top: 12, right: 12, bottom: 22, left: 12 };

export function LineChart({
  points,
  trend,
  height = 180,
  color = palette.accent,
  formatValue = (v) => String(Math.round(v * 10) / 10),
}: LineChartProps) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  if (points.length === 0) return null;

  const plotWidth = Math.max(0, width - PADDING.left - PADDING.right);
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const values = [...points.map((p) => p.value), ...(trend ?? []).map((p) => p.value)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; give it a band so the line sits mid-plot.
  const span = max - min || Math.max(1, Math.abs(max) * 0.02);
  const padded = { min: min - span * 0.1, max: max + span * 0.1 };

  const x = (index: number) =>
    PADDING.left +
    (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) =>
    PADDING.top +
    plotHeight -
    ((value - padded.min) / (padded.max - padded.min)) * plotHeight;

  const toPath = (series: readonly LinePoint[]) =>
    series
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.value)}`)
      .join(' ');

  const active = selected !== null ? points[selected] : null;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {/* One recessive baseline rather than a grid: the shape of the line
                is the message, and gridlines would compete with it. */}
            <Line
              x1={PADDING.left}
              y1={PADDING.top + plotHeight}
              x2={PADDING.left + plotWidth}
              y2={PADDING.top + plotHeight}
              stroke={palette.border}
              strokeWidth={1}
            />

            {trend && trend.length > 1 ? (
              <>
                <Path
                  d={toPath(points)}
                  stroke={color}
                  strokeWidth={1}
                  strokeOpacity={0.35}
                  fill="none"
                />
                <Path
                  d={toPath(trend)}
                  stroke={color}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </>
            ) : (
              <Path
                d={toPath(points)}
                stroke={color}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            )}

            {points.map((point, index) => (
              <Circle
                key={point.label + index}
                cx={x(index)}
                cy={y(point.value)}
                r={selected === index ? DOT_RADIUS + 2 : DOT_RADIUS}
                fill={selected === index ? color : palette.surface}
                stroke={color}
                strokeWidth={STROKE}
              />
            ))}
          </Svg>
        ) : null}

        {/* Touch targets are far larger than the dots, which are only 3px. */}
        {width > 0
          ? points.map((point, index) => (
              <Pressable
                key={`hit-${point.label}-${index}`}
                accessibilityRole="button"
                accessibilityLabel={`${point.label}: ${formatValue(point.value)}`}
                onPress={() => setSelected(selected === index ? null : index)}
                style={{
                  position: 'absolute',
                  left: x(index) - TAP_RADIUS * 2,
                  top: 0,
                  width: TAP_RADIUS * 4,
                  height,
                }}
              />
            ))
          : null}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" color={palette.textTertiary}>
          {points[0]?.label}
        </Text>
        {points.length > 1 ? (
          <Text variant="caption" color={palette.textTertiary}>
            {points[points.length - 1]?.label}
          </Text>
        ) : null}
      </View>

      {active ? (
        <View
          style={{
            marginTop: spacing.sm,
            alignSelf: 'flex-start',
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            borderRadius: radius.sm,
            backgroundColor: palette.surfaceRaised,
          }}
        >
          <Text variant="caption" color={palette.textSecondary}>
            {active.label} · {formatValue(active.value)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
