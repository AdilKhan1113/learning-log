/**
 * Today. The ring, the macro bars, the meals and water.
 */
import { useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { palette, spacing } from '../../src/ui/theme/index.ts';
import { MEALS } from '../../src/domain/nutrition/totals.ts';
import type { Meal } from '../../src/domain/types.ts';
import { useSession } from '../../src/state/session.ts';
import { useToday } from '../../src/features/dashboard/useToday.ts';
import { CalorieSummary } from '../../src/features/dashboard/CalorieSummary.tsx';
import { MealSection } from '../../src/features/dashboard/MealSection.tsx';
import { WaterCounter } from '../../src/features/dashboard/WaterCounter.tsx';
import { describeDay, today } from '../../src/utils/dates.ts';

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  const goal = useSession((s) => s.goal);
  const date = today();

  const {
    entries,
    totals,
    progress,
    waterMl,
    loading,
    error,
    reload,
    deleteEntry,
    addWater,
    removeWater,
  } = useToday(profile?.id ?? null, goal, date);

  // The log screen and the modals write directly to the database, so the
  // dashboard re-reads whenever it comes back into view.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const openLog = (meal: Meal) => router.push(`/log?meal=${meal}`);
  const containerMl = profile?.waterContainerMl ?? 250;

  if (loading && entries.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
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
        paddingBottom: spacing.xxxl,
        gap: spacing.xl,
      }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.textSecondary} />
      }
    >
      <View>
        <Text variant="title">{describeDay(date)}</Text>
        <Text variant="caption" color={palette.textSecondary}>
          {totals.entryCount === 1 ? '1 item logged' : `${totals.entryCount} items logged`}
        </Text>
      </View>

      {error ? (
        <View style={{ gap: spacing.md }}>
          <Text variant="body" color={palette.error}>
            {error}
          </Text>
          <Button title="Try again" variant="secondary" onPress={reload} />
        </View>
      ) : null}

      <CalorieSummary progress={progress} />

      {MEALS.map((meal) => (
        <MealSection
          key={meal}
          meal={meal}
          entries={entries.filter((e) => e.meal === meal)}
          kcal={totals.byMeal[meal].kcal}
          onAdd={openLog}
          onEdit={(entry) => router.push(`/modals/log-food?entryId=${entry.id}`)}
          onDelete={(entry) => void deleteEntry(entry.id)}
        />
      ))}

      <WaterCounter
        consumedMl={waterMl}
        targetMl={goal?.waterMlTarget ?? 2000}
        containerMl={containerMl}
        unit="ml"
        onAdd={() => void addWater(containerMl)}
        onUndo={() => void removeWater()}
      />
    </ScrollView>
  );
}
