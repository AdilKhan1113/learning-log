import { View } from 'react-native';
import { Text } from '../../ui/components/Text.tsx';
import { MacroBar } from '../../ui/components/MacroBar.tsx';
import { ProgressRing } from '../../ui/components/ProgressRing.tsx';
import { macroColors, palette, spacing } from '../../ui/theme/index.ts';
import type { DayProgress } from '../../domain/nutrition/totals.ts';
import { formatKcal, formatRemaining } from '../../utils/format.ts';

export interface CalorieSummaryProps {
  progress: DayProgress | null;
}

/**
 * The ring and macro bars.
 *
 * Every string here is a quantity. There is no encouragement, no warning, and
 * no change of tone once the target is passed — "220 over" is stated the same
 * way "220 left" is.
 */
export function CalorieSummary({ progress }: CalorieSummaryProps) {
  if (!progress) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
        <Text variant="body" color={palette.textSecondary}>
          Set a daily target to see your progress here.
        </Text>
      </View>
    );
  }

  const { calories, protein, carbs, fat } = progress;

  return (
    <View style={{ gap: spacing.xl }}>
      <View style={{ alignItems: 'center' }}>
        <ProgressRing ratio={calories.ratio} size={210}>
          <View style={{ alignItems: 'center' }}>
            <Text variant="display">{formatKcal(calories.consumed)}</Text>
            <Text variant="caption" color={palette.textSecondary}>
              of {formatKcal(calories.target)} kcal
            </Text>
            <Text variant="label" color={palette.textSecondary} style={{ marginTop: spacing.sm }}>
              {formatRemaining(calories.consumed, calories.target)}
            </Text>
          </View>
        </ProgressRing>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        <MacroBar
          label="Protein"
          consumed={protein.consumed}
          target={protein.target}
          color={macroColors.protein}
        />
        <MacroBar
          label="Carbs"
          consumed={carbs.consumed}
          target={carbs.target}
          color={macroColors.carbs}
        />
        <MacroBar
          label="Fat"
          consumed={fat.consumed}
          target={fat.target}
          color={macroColors.fat}
        />
      </View>
    </View>
  );
}
