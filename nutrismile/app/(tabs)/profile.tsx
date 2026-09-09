/**
 * Profile. Shows the target and the workings behind it, so a number the app
 * chose can be understood rather than just accepted.
 */
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { Card } from '../../src/ui/components/Card.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { TAB_BAR_HEIGHT, palette, spacing } from '../../src/ui/theme/index.ts';
import { useSession } from '../../src/state/session.ts';
import { listMissing, macroPercentages } from '../../src/domain/nutrition/goals.ts';
import {
  type Suggestion,
  useRecalculateTarget,
} from '../../src/features/profile/useRecalculateTarget.ts';
import type { DailyGoal } from '../../src/db/repositories/goals.ts';
import { formatGrams, formatKcal } from '../../src/utils/format.ts';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const profile = useSession((s) => s.profile);
  const goal = useSession((s) => s.goal);
  const refresh = useSession((s) => s.refresh);
  const recalculate = useRecalculateTarget(profile);

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingBottom: TAB_BAR_HEIGHT + insets.bottom + spacing.lg,
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

      <RecalculateCard
        recalculate={recalculate}
        currentGoal={goal}
        onApplied={() => void refresh()}
      />

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

/**
 * Recalculate the target from the profile as it stands now.
 *
 * Useful whenever an input has moved — a new weight, a different activity
 * level — or when the calculation itself has changed. The new numbers are
 * always shown before they are saved.
 */
function RecalculateCard({
  recalculate,
  currentGoal,
  onApplied,
}: {
  recalculate: ReturnType<typeof useRecalculateTarget>;
  currentGoal: DailyGoal | null;
  onApplied: () => void;
}) {
  const { missing, loading, preview, saving, error, compute, apply, cancel } = recalculate;

  if (loading) return null;

  if (missing.length > 0) {
    return (
      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">Recalculate target</Text>
        <Text variant="body" color={palette.textSecondary}>
          Add your {listMissing(missing)} and this can work your target out for
          you.
        </Text>
      </Card>
    );
  }

  if (!preview) {
    return (
      <Card style={{ gap: spacing.md }}>
        <Text variant="heading">Recalculate target</Text>
        <Text variant="body" color={palette.textSecondary}>
          Works your target out again from your current details. You'll see the
          new numbers before anything changes.
        </Text>
        <Button title="Recalculate" variant="secondary" fullWidth onPress={compute} />
      </Card>
    );
  }

  const unchanged =
    currentGoal !== null &&
    Math.abs(currentGoal.calorieTarget - preview.calorieTarget) < 1 &&
    Math.abs(currentGoal.proteinGTarget - preview.proteinGTarget) < 1 &&
    Math.abs(currentGoal.carbsGTarget - preview.carbsGTarget) < 1 &&
    Math.abs(currentGoal.fatGTarget - preview.fatGTarget) < 1;

  return (
    <Card style={{ gap: spacing.md }}>
      <Text variant="heading">{unchanged ? 'No change' : 'New target'}</Text>

      {unchanged ? (
        <Text variant="body" color={palette.textSecondary}>
          Your current target already matches your details.
        </Text>
      ) : (
        <>
          <Comparison current={currentGoal} next={preview} />
          {preview.floorApplied ? (
            <Text variant="caption" color={palette.textSecondary}>
              This is the lowest target NutriSmile sets.
            </Text>
          ) : null}
          {preview.proteinCapped ? (
            <Text variant="caption" color={palette.textSecondary}>
              Protein is held to about a third of your calories, leaving more
              room for carbs and fat.
            </Text>
          ) : null}
        </>
      )}

      {error ? (
        <Text variant="body" color={palette.error}>
          {error}
        </Text>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        {unchanged ? null : (
          <Button
            title="Use this target"
            fullWidth
            loading={saving}
            onPress={async () => {
              if (await apply()) onApplied();
            }}
          />
        )}
        <Button
          title={unchanged ? 'Close' : 'Keep my current target'}
          variant="ghost"
          fullWidth
          onPress={cancel}
        />
      </View>
    </Card>
  );
}

/** Current values beside proposed ones, so the change is visible at a glance. */
function Comparison({ current, next }: { current: DailyGoal | null; next: Suggestion }) {
  const rows: { label: string; from: string; to: string }[] = [
    {
      label: 'Calories',
      from: current ? formatKcal(current.calorieTarget) : '—',
      to: formatKcal(next.calorieTarget),
    },
    {
      label: 'Protein',
      from: current ? formatGrams(current.proteinGTarget) : '—',
      to: formatGrams(next.proteinGTarget),
    },
    {
      label: 'Carbs',
      from: current ? formatGrams(current.carbsGTarget) : '—',
      to: formatGrams(next.carbsGTarget),
    },
    {
      label: 'Fat',
      from: current ? formatGrams(current.fatGTarget) : '—',
      to: formatGrams(next.fatGTarget),
    },
  ];

  return (
    <View style={{ gap: spacing.xs }}>
      {rows.map((row) => (
        <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text variant="body" color={palette.textSecondary} style={{ flex: 1 }}>
            {row.label}
          </Text>
          <Text variant="body" color={palette.textTertiary}>
            {row.from}
          </Text>
          <Text variant="body" color={palette.textTertiary} style={{ marginHorizontal: spacing.sm }}>
            →
          </Text>
          <Text variant="body">{row.to}</Text>
        </View>
      ))}
    </View>
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
