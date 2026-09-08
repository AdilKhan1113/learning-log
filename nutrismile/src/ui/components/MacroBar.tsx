import { View } from 'react-native';
import { Text } from './Text.tsx';
import { palette, radius, spacing } from '../theme/index.ts';
import { formatGrams } from '../../utils/format.ts';

export interface MacroBarProps {
  label: string;
  consumed: number;
  target: number;
  color: string;
}

/**
 * One macro's progress.
 *
 * Past the target the bar fills and stops; the numbers beneath still read
 * "180 / 135g", which is the honest statement of what happened.
 */
export function MacroBar({ label, consumed, target, color }: MacroBarProps) {
  const ratio = target > 0 ? consumed / target : 0;
  const width = `${Math.max(0, Math.min(1, ratio)) * 100}%` as const;

  return (
    <View style={{ flex: 1, gap: spacing.xs }}>
      <Text variant="caption" color={palette.textSecondary}>
        {label}
      </Text>
      <View
        style={{
          height: 6,
          borderRadius: radius.pill,
          backgroundColor: palette.track,
          overflow: 'hidden',
        }}
      >
        <View style={{ width, height: '100%', backgroundColor: color, borderRadius: radius.pill }} />
      </View>
      <Text variant="caption" color={palette.textSecondary}>
        {formatGrams(consumed)} / {formatGrams(target)}
      </Text>
    </View>
  );
}
