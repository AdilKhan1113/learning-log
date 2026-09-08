/**
 * The serving sheet: choose a quantity and a unit, see the nutrition update as
 * you type, confirm.
 *
 * All arithmetic comes from the tested pure functions. When a unit cannot be
 * resolved — a volume for a food with no known density — the reason is shown
 * rather than a zero or a guess.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Text } from '../../ui/components/Text.tsx';
import { Button } from '../../ui/components/Button.tsx';
import { HIT_SIZE, macroColors, palette, radius, spacing } from '../../ui/theme/index.ts';
import type { FoodLike, Meal, Nutrition } from '../../domain/types.ts';
import { MEALS, MEAL_LABELS } from '../../domain/nutrition/totals.ts';
import {
  type ServingError,
  availableUnits,
  nutritionForServing,
} from '../../domain/nutrition/serving.ts';
import { formatGrams, formatKcal } from '../../utils/format.ts';

export interface ServingEditorProps {
  food: FoodLike;
  initialMeal: Meal;
  initialQuantity?: number;
  initialUnit?: string;
  confirmLabel?: string;
  onConfirm: (result: {
    quantity: number;
    unitLabel: string;
    amountInBasis: number;
    nutrition: Nutrition;
    meal: Meal;
  }) => void;
}

/** Plain-language explanation of why a serving could not be worked out. */
function describeError(error: ServingError, food: FoodLike): string {
  switch (error.code) {
    case 'density_required':
      return `${food.name} doesn't have a weight-per-volume recorded, so cups and fluid ounces can't be converted. Use grams or a listed serving.`;
    case 'unknown_unit':
      return `"${error.unit}" isn't a unit this food can be measured in.`;
    case 'unknown_portion':
      return `"${error.label}" isn't a serving recorded for this food.`;
    case 'invalid_quantity':
      return 'Enter an amount greater than zero.';
  }
}

export function ServingEditor({
  food,
  initialMeal,
  initialQuantity,
  initialUnit,
  confirmLabel = 'Add to log',
  onConfirm,
}: ServingEditorProps) {
  const units = useMemo(() => availableUnits(food), [food]);
  const defaultUnit = initialUnit ?? units.find((u) => u.isDefault)?.label ?? 'g';

  const [text, setText] = useState(String(initialQuantity ?? 1));
  const [unitLabel, setUnitLabel] = useState(defaultUnit);
  const [meal, setMeal] = useState<Meal>(initialMeal);

  const quantity = Number.parseFloat(text.replace(',', '.'));
  const computed = useMemo(
    () => nutritionForServing(food, quantity, unitLabel),
    [food, quantity, unitLabel],
  );

  const nutrition = computed.ok ? computed.value.nutrition : null;

  return (
    <View style={{ gap: spacing.xl, padding: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <Text variant="title">{food.name}</Text>
        {food.brand ? (
          <Text variant="caption" color={palette.textSecondary}>
            {food.brand}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <TextInput
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          selectTextOnFocus
          accessibilityLabel="Amount"
          style={{
            width: 96,
            minHeight: HIT_SIZE,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.md,
            backgroundColor: palette.surfaceRaised,
            color: palette.text,
            fontSize: 22,
            fontWeight: '600',
          }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {units.map((unit) => {
              const selected = unit.label === unitLabel;
              return (
                <Pressable
                  key={`${unit.kind}:${unit.label}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setUnitLabel(unit.label)}
                  style={{
                    minHeight: HIT_SIZE,
                    paddingHorizontal: spacing.lg,
                    justifyContent: 'center',
                    borderRadius: radius.pill,
                    backgroundColor: selected ? palette.accentMuted : palette.surfaceRaised,
                  }}
                >
                  <Text variant="label" color={selected ? palette.accent : palette.text}>
                    {unit.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {nutrition ? (
        <View style={{ gap: spacing.md }}>
          <Text variant="display">{formatKcal(nutrition.kcal)}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xl }}>
            <MacroReadout label="Protein" grams={nutrition.proteinG} color={macroColors.protein} />
            <MacroReadout label="Carbs" grams={nutrition.carbsG} color={macroColors.carbs} />
            <MacroReadout label="Fat" grams={nutrition.fatG} color={macroColors.fat} />
          </View>
        </View>
      ) : (
        <View
          style={{
            padding: spacing.lg,
            borderRadius: radius.md,
            backgroundColor: palette.errorSurface,
          }}
        >
          <Text variant="body" color={palette.error}>
            {computed.ok ? '' : describeError(computed.error, food)}
          </Text>
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text variant="caption" color={palette.textSecondary}>
          Meal
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {MEALS.map((option) => {
            const selected = option === meal;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setMeal(option)}
                style={{
                  flex: 1,
                  minHeight: HIT_SIZE,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.md,
                  backgroundColor: selected ? palette.accentMuted : palette.surfaceRaised,
                }}
              >
                <Text variant="caption" color={selected ? palette.accent : palette.textSecondary}>
                  {MEAL_LABELS[option]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Button
        title={confirmLabel}
        fullWidth
        disabled={!computed.ok}
        onPress={() => {
          if (!computed.ok) return;
          onConfirm({
            quantity,
            unitLabel,
            amountInBasis: computed.value.amountInBasis,
            nutrition: computed.value.nutrition,
            meal,
          });
        }}
      />
    </View>
  );
}

function MacroReadout({
  label,
  grams,
  color,
}: {
  label: string;
  grams: number;
  color: string;
}) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" color={palette.textSecondary}>
        {label}
      </Text>
      <Text variant="heading" color={color}>
        {formatGrams(grams)}
      </Text>
    </View>
  );
}
