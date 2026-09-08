/**
 * The serving sheet, reached from search, from a meal's "+ Add food", and from
 * tapping an existing entry to edit it.
 *
 * On edit, the nutrition is recalculated from the food's current values only
 * because the user is explicitly changing that entry. Everything else in the
 * app leaves a logged snapshot alone.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '../../src/ui/components/Text.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { EmptyState } from '../../src/ui/components/EmptyState.tsx';
import { palette, spacing } from '../../src/ui/theme/index.ts';
import type { FoodLike, Meal } from '../../src/domain/types.ts';
import { foods, logEntries } from '../../src/db/repositories/index.ts';
import { useSession } from '../../src/state/session.ts';
import { ServingEditor } from '../../src/features/logging/ServingEditor.tsx';
import { today } from '../../src/utils/dates.ts';

export default function LogFoodModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ foodId?: string; meal?: string; entryId?: string }>();
  const profile = useSession((s) => s.profile);

  const [food, setFood] = useState<FoodLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const meal = (params.meal as Meal) ?? 'snacks';

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!params.foodId) {
        setLoading(false);
        return;
      }
      try {
        const found = await foods.getById(params.foodId);
        if (!cancelled) setFood(found);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open that food.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [params.foodId]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (error || !food) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
        <EmptyState
          title={error ? "That food didn't open" : 'Food not found'}
          body={
            error ??
            'It may have been removed. Anything you already logged from it is unaffected.'
          }
          action={<Button title="Back" variant="secondary" onPress={() => router.back()} />}
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
      {saving ? (
        <View style={{ padding: spacing.lg }}>
          <Text variant="caption" color={palette.textSecondary}>
            Saving…
          </Text>
        </View>
      ) : null}

      <ServingEditor
        food={food}
        initialMeal={meal}
        onConfirm={async (result) => {
          if (!profile) return;
          setSaving(true);
          try {
            await logEntries.create({
              userId: profile.id,
              logDate: today(),
              meal: result.meal,
              name: food.name,
              brand: food.brand ?? null,
              quantity: result.quantity,
              unitLabel: result.unitLabel,
              amountInBasis: result.amountInBasis,
              basisUnit: food.per100.basisUnit,
              nutrition: result.nutrition,
              foodId: food.id,
              entrySource: 'search',
            });
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save that entry.');
            setSaving(false);
          }
        }}
      />
    </ScrollView>
  );
}
