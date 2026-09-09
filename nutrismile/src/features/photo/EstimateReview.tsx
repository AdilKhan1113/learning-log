/**
 * Reviewing a photo estimate before it is logged.
 *
 * Every line is editable and removable, the confidence of each is visible, and
 * nothing reaches the log until the user presses the button at the bottom.
 * The screen states what the numbers are — estimates — without apologising for
 * them or overselling them.
 */
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Text } from '../../ui/components/Text.tsx';
import { Button } from '../../ui/components/Button.tsx';
import { Card } from '../../ui/components/Card.tsx';
import { HIT_SIZE, macroColors, palette, radius, spacing } from '../../ui/theme/index.ts';
import type { Meal } from '../../domain/types.ts';
import { MEALS, MEAL_LABELS } from '../../domain/nutrition/totals.ts';
import type { EstimatedFood, MealEstimate } from '../../services/vision/index.ts';
import { describeDropReason } from '../../services/vision/index.ts';
import { formatGrams, formatKcal } from '../../utils/format.ts';

export interface EstimateReviewProps {
  estimate: MealEstimate;
  saving: boolean;
  onSetPortion: (foodId: string, grams: number) => void;
  onRemove: (foodId: string) => void;
  onConfirm: (meal: Meal) => void;
  onDiscard: () => void;
}

/** Confidence as words. A bare "0.42" means nothing to a person. */
function describeConfidence(confidence: number): string {
  if (confidence >= 0.75) return 'Fairly confident';
  if (confidence >= 0.45) return 'Rough estimate';
  return 'Low confidence';
}

export function EstimateReview({
  estimate,
  saving,
  onSetPortion,
  onRemove,
  onConfirm,
  onDiscard,
}: EstimateReviewProps) {
  const [meal, setMeal] = useState<Meal>('lunch');

  const totals = estimate.foods.reduce(
    (sum, food) => ({
      kcal: sum.kcal + food.kcal,
      proteinG: sum.proteinG + food.proteinG,
      carbsG: sum.carbsG + food.carbsG,
      fatG: sum.fatG + food.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  return (
    <View style={{ gap: spacing.lg, padding: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <Text variant="title">Check this over</Text>
        <Text variant="body" color={palette.textSecondary}>
          These are estimates from the photo. Adjust anything that looks off —
          nothing is logged until you say so.
        </Text>
        {estimate.source ? (
          <Text variant="caption" color={palette.textTertiary}>
            Estimated by {estimate.source.model}
          </Text>
        ) : null}
      </View>

      {estimate.note ? (
        <Card style={{ gap: spacing.xs }}>
          <Text variant="caption" color={palette.textSecondary}>
            From the estimate
          </Text>
          <Text variant="body">{estimate.note}</Text>
        </Card>
      ) : null}

      {estimate.dropped.length > 0 ? (
        <Text variant="caption" color={palette.textTertiary}>
          Left out: {estimate.dropped.map((d) => describeDropReason(d.reason)).join(', ')}.
        </Text>
      ) : null}

      {estimate.foods.map((food) => (
        <FoodRow
          key={food.id}
          food={food}
          onSetPortion={onSetPortion}
          onRemove={onRemove}
        />
      ))}

      {estimate.foods.length === 0 ? (
        <Card>
          <Text variant="body" color={palette.textSecondary}>
            You've removed every item. Discard this and try another photo, or
            search for the food instead.
          </Text>
        </Card>
      ) : (
        <Card style={{ gap: spacing.sm }}>
          <Text variant="heading">{formatKcal(totals.kcal)} kcal in total</Text>
          <Text variant="caption" color={palette.textSecondary}>
            {formatGrams(totals.proteinG)} protein · {formatGrams(totals.carbsG)} carbs ·{' '}
            {formatGrams(totals.fatG)} fat
          </Text>
        </Card>
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

      <View style={{ gap: spacing.sm }}>
        <Button
          title={
            estimate.foods.length === 1
              ? 'Log this item'
              : `Log these ${estimate.foods.length} items`
          }
          fullWidth
          loading={saving}
          disabled={estimate.foods.length === 0}
          onPress={() => onConfirm(meal)}
        />
        <Button title="Discard" variant="ghost" fullWidth onPress={onDiscard} />
      </View>
    </View>
  );
}

function FoodRow({
  food,
  onSetPortion,
  onRemove,
}: {
  food: EstimatedFood;
  onSetPortion: (foodId: string, grams: number) => void;
  onRemove: (foodId: string) => void;
}) {
  const [text, setText] = useState(String(food.grams));

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading">{food.name}</Text>
          <Text variant="caption" color={palette.textTertiary}>
            {describeConfidence(food.confidence)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${food.name}`}
          onPress={() => onRemove(food.id)}
          style={({ pressed }) => ({
            minHeight: HIT_SIZE,
            minWidth: HIT_SIZE,
            alignItems: 'flex-end',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="label" color={palette.textSecondary}>
            Remove
          </Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <TextInput
          value={text}
          onChangeText={setText}
          onEndEditing={() => {
            const grams = Number.parseFloat(text.replace(',', '.'));
            if (Number.isFinite(grams) && grams > 0) {
              onSetPortion(food.id, grams);
            } else {
              setText(String(food.grams));
            }
          }}
          keyboardType="decimal-pad"
          selectTextOnFocus
          accessibilityLabel={`Portion of ${food.name} in grams`}
          style={{
            width: 88,
            minHeight: HIT_SIZE,
            paddingHorizontal: spacing.md,
            borderRadius: radius.md,
            backgroundColor: palette.surfaceRaised,
            color: palette.text,
            fontSize: 18,
            fontWeight: '600',
          }}
        />
        <Text variant="body" color={palette.textSecondary}>
          g
        </Text>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'flex-end',
            gap: spacing.xs,
          }}
        >
          <Text variant="heading">{formatKcal(food.kcal)}</Text>
          <Text variant="caption" color={palette.textSecondary}>
            kcal
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        <Macro label="Protein" grams={food.proteinG} color={macroColors.protein} />
        <Macro label="Carbs" grams={food.carbsG} color={macroColors.carbs} />
        <Macro label="Fat" grams={food.fatG} color={macroColors.fat} />
      </View>
    </Card>
  );
}

function Macro({ label, grams, color }: { label: string; grams: number; color: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" color={palette.textSecondary}>
        {label}
      </Text>
      <Text variant="label" color={color}>
        {formatGrams(grams)}
      </Text>
    </View>
  );
}
