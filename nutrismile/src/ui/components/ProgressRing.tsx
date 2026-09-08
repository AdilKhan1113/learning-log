import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { palette } from '../theme/index.ts';

export interface ProgressRingProps {
  /** consumed / target. Values above 1 are drawn as a completed ring. */
  ratio: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  children?: React.ReactNode;
}

/**
 * The calories ring.
 *
 * The arc stops at full rather than wrapping around a second time, and it does
 * not change colour when the target is passed — the numbers inside say what
 * happened, and a ring turning red would be the app editorialising.
 */
export function ProgressRing({
  ratio,
  size = 200,
  strokeWidth = 14,
  color = palette.accent,
  children,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const dashOffset = circumference * (1 - clamped);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={palette.track}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          fill="none"
          // Start the arc at the top rather than at three o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}
