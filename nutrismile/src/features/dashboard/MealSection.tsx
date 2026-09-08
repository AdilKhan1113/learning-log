import { useRef } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '../../ui/components/Text.tsx';
import { Card } from '../../ui/components/Card.tsx';
import { HIT_SIZE, palette, radius, spacing } from '../../ui/theme/index.ts';
import type { Meal } from '../../domain/types.ts';
import { MEAL_LABELS } from '../../domain/nutrition/totals.ts';
import type { LogEntry } from '../../db/repositories/logEntries.ts';
import { formatKcal, formatQuantity } from '../../utils/format.ts';

export interface MealSectionProps {
  meal: Meal;
  entries: LogEntry[];
  kcal: number;
  onAdd: (meal: Meal) => void;
  onEdit: (entry: LogEntry) => void;
  onDelete: (entry: LogEntry) => void;
}

/** One entry row: swipe to delete, tap to edit. */
function EntryRow({
  entry,
  onEdit,
  onDelete,
}: {
  entry: LogEntry;
  onEdit: (entry: LogEntry) => void;
  onDelete: (entry: LogEntry) => void;
}) {
  const swipeable = useRef<Swipeable>(null);

  return (
    <Swipeable
      ref={swipeable}
      renderRightActions={(_, dragX) => {
        const opacity = dragX.interpolate({
          inputRange: [-80, -20],
          outputRange: [1, 0],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View
            style={{
              opacity,
              justifyContent: 'center',
              paddingHorizontal: spacing.lg,
            }}
          >
            <Text variant="label" color={palette.error}>
              Remove
            </Text>
          </Animated.View>
        );
      }}
      onSwipeableOpen={() => {
        swipeable.current?.close();
        onDelete(entry);
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${entry.name}, ${formatKcal(entry.nutrition.kcal)} calories. Tap to edit.`}
        onPress={() => onEdit(entry)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: HIT_SIZE,
          paddingVertical: spacing.sm,
          backgroundColor: pressed ? palette.surfaceRaised : palette.surface,
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>
              {entry.name}
            </Text>
            {entry.isEstimate ? <EstimateTag /> : null}
          </View>
          <Text variant="caption" color={palette.textTertiary}>
            {formatQuantity(entry.quantity)} {entry.unitLabel}
            {entry.brand ? ` · ${entry.brand}` : ''}
          </Text>
        </View>
        <Text variant="label" color={palette.textSecondary}>
          {formatKcal(entry.nutrition.kcal)}
        </Text>
      </Pressable>
    </Swipeable>
  );
}

/** Marks a row whose numbers came from the photo estimator, never a scan or
 *  a database lookup. Added in Phase 4; the flag is stored from day one. */
function EstimateTag() {
  return (
    <View
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radius.sm,
        backgroundColor: palette.surfaceRaised,
      }}
    >
      <Text variant="caption" color={palette.textSecondary}>
        Estimate
      </Text>
    </View>
  );
}

export function MealSection({
  meal,
  entries,
  kcal,
  onAdd,
  onEdit,
  onDelete,
}: MealSectionProps) {
  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="heading" style={{ flex: 1 }}>
          {MEAL_LABELS[meal]}
        </Text>
        <Text variant="label" color={palette.textSecondary}>
          {formatKcal(kcal)}
        </Text>
      </View>

      {entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} onEdit={onEdit} onDelete={onDelete} />
      ))}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add food to ${MEAL_LABELS[meal]}`}
        onPress={() => onAdd(meal)}
        style={({ pressed }) => ({
          minHeight: HIT_SIZE,
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text variant="label" color={palette.accent}>
          + Add food
        </Text>
      </Pressable>
    </Card>
  );
}
