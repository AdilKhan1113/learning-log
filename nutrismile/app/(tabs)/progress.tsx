/**
 * Progress. Weight over time, averages by period, days logged.
 *
 * Every number here is reported and nothing is praised or scolded. A streak is
 * a count of days recorded, not a measure of virtue, and a broken one is
 * stated without comment.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { Card } from '../../src/ui/components/Card.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { EmptyState } from '../../src/ui/components/EmptyState.tsx';
import { LineChart } from '../../src/ui/components/LineChart.tsx';
import { BarChart, type BarDatum } from '../../src/ui/components/BarChart.tsx';
import {
  HIT_SIZE,
  TAB_BAR_HEIGHT,
  macroColors,
  palette,
  radius,
  spacing,
} from '../../src/ui/theme/index.ts';
import type { Period } from '../../src/domain/progress/trends.ts';
import { useSession } from '../../src/state/session.ts';
import { useProgress } from '../../src/features/progress/useProgress.ts';
import { formatGrams, formatKcal, formatWeight } from '../../src/utils/format.ts';

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const profile = useSession((s) => s.profile);
  const progress = useProgress(profile?.id ?? null);
  const { reload } = progress;

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const unitSystem = profile?.unitSystem ?? 'metric';

  if (progress.loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: palette.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingBottom: TAB_BAR_HEIGHT + insets.bottom + spacing.lg,
        gap: spacing.xl,
      }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => void reload()}
          tintColor={palette.textSecondary}
        />
      }
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="title">Progress</Text>

      {progress.error ? (
        <Text variant="body" color={palette.error}>
          {progress.error}
        </Text>
      ) : null}

      <StreakCard streak={progress.streak} />
      <WeightCard progress={progress} unitSystem={unitSystem} />
      <AveragesCard progress={progress} />
    </ScrollView>
  );
}

/** A count of days recorded. Stated, never celebrated or mourned. */
function StreakCard({ streak }: { streak: ReturnType<typeof useProgress>['streak'] }) {
  return (
    <Card style={{ gap: spacing.sm }}>
      <Text variant="heading">Days logged</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
        <Text variant="display">{streak.current}</Text>
        <Text variant="body" color={palette.textSecondary}>
          in a row
        </Text>
      </View>
      {streak.todayPending && streak.current > 0 ? (
        <Text variant="caption" color={palette.textSecondary}>
          Today isn't logged yet.
        </Text>
      ) : null}
      {streak.longest > streak.current ? (
        <Text variant="caption" color={palette.textTertiary}>
          Longest so far: {streak.longest}
        </Text>
      ) : null}
    </Card>
  );
}

function WeightCard({
  progress,
  unitSystem,
}: {
  progress: ReturnType<typeof useProgress>;
  unitSystem: 'metric' | 'imperial';
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const { trend } = progress;

  async function save() {
    const entered = Number.parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(entered) || entered <= 0) return;
    // Stored in kilograms whatever the user types in.
    const kg = unitSystem === 'imperial' ? entered * 0.45359237 : entered;
    setSaving(true);
    try {
      await progress.recordWeight(kg);
      setText('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text variant="heading" style={{ flex: 1 }}>
          Weight
        </Text>
        {trend.latest ? (
          <Text variant="label" color={palette.textSecondary}>
            {formatWeight(trend.latest.weightKg, unitSystem)}
          </Text>
        ) : null}
      </View>

      {trend.points.length >= 2 ? (
        <>
          <LineChart
            points={trend.points.map((p) => ({ label: p.date.slice(5), value: p.weightKg }))}
            trend={trend.trend.map((p) => ({ label: p.date.slice(5), value: p.value }))}
            formatValue={(v) => formatWeight(v, unitSystem)}
          />
          {trend.rateKgPerWeek !== null ? (
            <Text variant="caption" color={palette.textSecondary}>
              {describeRate(trend.rateKgPerWeek, unitSystem)}
            </Text>
          ) : null}
          <Text variant="caption" color={palette.textTertiary}>
            The line is a 7-day average. Day-to-day weight moves mostly with water.
          </Text>
        </>
      ) : (
        <Text variant="body" color={palette.textSecondary}>
          {trend.points.length === 1
            ? 'One reading so far. A second gives you a trend.'
            : 'No weight recorded yet.'}
        </Text>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={unitSystem === 'imperial' ? '154' : '70'}
          placeholderTextColor={palette.textTertiary}
          keyboardType="decimal-pad"
          accessibilityLabel="Today's weight"
          style={{
            width: 110,
            minHeight: HIT_SIZE,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.md,
            backgroundColor: palette.surfaceRaised,
            color: palette.text,
            fontSize: 18,
            fontWeight: '600',
          }}
        />
        <Text variant="body" color={palette.textSecondary}>
          {unitSystem === 'imperial' ? 'lb' : 'kg'}
        </Text>
        <View style={{ flex: 1 }}>
          <Button
            title="Save today"
            fullWidth
            loading={saving}
            disabled={text.trim() === ''}
            onPress={save}
          />
        </View>
      </View>
    </Card>
  );
}

/** Neutral phrasing: a direction and a rate, with no verdict attached. */
function describeRate(kgPerWeek: number, unitSystem: 'metric' | 'imperial'): string {
  const perWeek = unitSystem === 'imperial' ? kgPerWeek / 0.45359237 : kgPerWeek;
  const unit = unitSystem === 'imperial' ? 'lb' : 'kg';
  const size = Math.abs(perWeek).toFixed(2);

  if (Math.abs(perWeek) < 0.05) return 'Holding steady over this period.';
  return perWeek < 0
    ? `Down about ${size} ${unit} a week over this period.`
    : `Up about ${size} ${unit} a week over this period.`;
}

function AveragesCard({ progress }: { progress: ReturnType<typeof useProgress> }) {
  const { periods, period, setPeriod } = progress;

  const calorieBars: BarDatum[] = periods.map((p) => ({
    label: p.label,
    segments: [
      { key: 'kcal', label: 'Calories', value: p.average.kcal, color: palette.accent },
    ],
    detail: `${formatKcal(p.average.kcal)} kcal average over ${p.daysLogged} ${
      p.daysLogged === 1 ? 'day' : 'days'
    }`,
  }));

  const macroBars: BarDatum[] = periods.map((p) => ({
    label: p.label,
    segments: [
      { key: 'protein', label: 'Protein', value: p.average.proteinG, color: macroColors.protein },
      { key: 'carbs', label: 'Carbs', value: p.average.carbsG, color: macroColors.carbs },
      { key: 'fat', label: 'Fat', value: p.average.fatG, color: macroColors.fat },
    ],
    detail: `${formatGrams(p.average.proteinG)} protein · ${formatGrams(
      p.average.carbsG,
    )} carbs · ${formatGrams(p.average.fatG)} fat`,
  }));

  return (
    <Card style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="heading" style={{ flex: 1 }}>
          Averages
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {(['week', 'month'] as const).map((option) => (
            <PeriodTab
              key={option}
              label={option === 'week' ? 'Weekly' : 'Monthly'}
              selected={period === option}
              onPress={() => setPeriod(option)}
            />
          ))}
        </View>
      </View>

      {periods.length === 0 ? (
        <EmptyState
          title="Nothing to average yet"
          body="Log a few days and the averages will build up here."
        />
      ) : (
        <>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label" color={palette.textSecondary}>
              Calories a day
            </Text>
            {/* One series, so no legend — the label above names it. */}
            <BarChart data={calorieBars} height={140} />
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text variant="label" color={palette.textSecondary}>
              Macros a day
            </Text>
            <BarChart
              data={macroBars}
              height={140}
              legend={[
                { label: 'Protein', color: macroColors.protein },
                { label: 'Carbs', color: macroColors.carbs },
                { label: 'Fat', color: macroColors.fat },
              ]}
            />
          </View>

          <Text variant="caption" color={palette.textTertiary}>
            Averaged over the days you logged, not the whole {period}. Tap a bar for
            its numbers.
          </Text>
        </>
      )}
    </Card>
  );
}

function PeriodTab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: HIT_SIZE - 12,
        paddingHorizontal: spacing.md,
        justifyContent: 'center',
        borderRadius: radius.pill,
        backgroundColor: selected ? palette.accentMuted : 'transparent',
      }}
    >
      <Text variant="caption" color={selected ? palette.accent : palette.textSecondary}>
        {label}
      </Text>
    </Pressable>
  );
}
