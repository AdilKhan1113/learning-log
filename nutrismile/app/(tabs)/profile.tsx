/**
 * Profile. Shows the target and the workings behind it, so a number the app
 * chose can be understood rather than just accepted.
 */
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { Card } from '../../src/ui/components/Card.tsx';
import { palette, spacing } from '../../src/ui/theme/index.ts';
import { useSession } from '../../src/state/session.ts';
import { macroPercentages } from '../../src/domain/nutrition/goals.ts';
import { formatGrams, formatKcal } from '../../src/utils/format.ts';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const profile = useSession((s) => s.profile);
  const goal = useSession((s) => s.goal);

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxxl,
        gap: spacing.xl,
      }}
    >
      <Text variant="title">Profile</Text>

      {goal ? (
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading">Daily target</Text>
          <Text variant="display">{formatKcal(goal.calorieTarget)}</Text>

          <View style={{ gap: spacing.xs }}>
            <Row label="Protein" value={formatGrams(goal.proteinGTarget)} />
            <Row label="Carbs" value={formatGrams(goal.carbsGTarget)} />
            <Row label="Fat" value={formatGrams(goal.fatGTarget)} />
          </View>

          <Text variant="caption" color={palette.textTertiary}>
            {describeSplit(goal)}
          </Text>
        </Card>
      ) : null}

      {goal?.bmrKcal && goal?.tdeeKcal ? (
        <Card style={{ gap: spacing.sm }}>
          <Text variant="heading">How this was worked out</Text>
          <Row label="Resting metabolic rate" value={`${formatKcal(goal.bmrKcal)} kcal`} />
          <Row label="With your activity level" value={`${formatKcal(goal.tdeeKcal)} kcal`} />
          <Row label="Your target" value={`${formatKcal(goal.calorieTarget)} kcal`} />
          {goal.floorApplied ? (
            <Text variant="caption" color={palette.textSecondary} style={{ marginTop: spacing.sm }}>
              This target is the lowest NutriSmile sets, so it's higher than the
              rate you picked would give on its own.
            </Text>
          ) : null}
          <Text variant="caption" color={palette.textTertiary} style={{ marginTop: spacing.sm }}>
            Estimated with the Mifflin-St Jeor equation. Like any estimate, it's
            a starting point to adjust from.
          </Text>
        </Card>
      ) : null}

      {profile ? (
        <Card style={{ gap: spacing.sm }}>
          <Text variant="heading">Details</Text>
          <Row label="Height" value={profile.heightCm ? `${profile.heightCm} cm` : '—'} />
          <Row label="Activity" value={profile.activityLevel ?? '—'} />
          <Row label="Goal" value={profile.goalType ?? '—'} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text variant="body" color={palette.textSecondary} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

function describeSplit(goal: {
  calorieTarget: number;
  proteinGTarget: number;
  carbsGTarget: number;
  fatGTarget: number;
}): string {
  const pct = macroPercentages(goal);
  return `${Math.round(pct.proteinPct)}% protein · ${Math.round(pct.carbsPct)}% carbs · ${Math.round(pct.fatPct)}% fat`;
}
