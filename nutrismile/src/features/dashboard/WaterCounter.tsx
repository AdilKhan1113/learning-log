import { Pressable, View } from 'react-native';
import { Text } from '../../ui/components/Text.tsx';
import { Card } from '../../ui/components/Card.tsx';
import { HIT_SIZE, palette, radius, spacing } from '../../ui/theme/index.ts';
import { formatWater } from '../../utils/format.ts';

export interface WaterCounterProps {
  consumedMl: number;
  targetMl: number;
  containerMl: number;
  unit: 'ml' | 'floz';
  onAdd: () => void;
  onUndo: () => void;
}

/** Water intake. One tap adds a container; the undo removes the last one. */
export function WaterCounter({
  consumedMl,
  targetMl,
  containerMl,
  unit,
  onAdd,
  onUndo,
}: WaterCounterProps) {
  const filled = containerMl > 0 ? Math.floor(consumedMl / containerMl) : 0;
  const total = containerMl > 0 ? Math.ceil(targetMl / containerMl) : 0;

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="heading" style={{ flex: 1 }}>
          Water
        </Text>
        <Text variant="label" color={palette.textSecondary}>
          {formatWater(consumedMl, unit)} of {formatWater(targetMl, unit)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {Array.from({ length: Math.max(total, filled) }, (_, i) => (
          <View
            key={i}
            style={{
              width: 26,
              height: 34,
              borderRadius: radius.sm,
              borderWidth: 1.5,
              borderColor: i < filled ? palette.water : palette.border,
              backgroundColor: i < filled ? palette.water : 'transparent',
            }}
          />
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${formatWater(containerMl, unit)} of water`}
          onPress={onAdd}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: HIT_SIZE,
            borderRadius: radius.pill,
            backgroundColor: palette.surfaceRaised,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text variant="label">+ {formatWater(containerMl, unit)}</Text>
        </Pressable>

        {consumedMl > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo the last water entry"
            onPress={onUndo}
            style={({ pressed }) => ({
              minHeight: HIT_SIZE,
              paddingHorizontal: spacing.lg,
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text variant="label" color={palette.textSecondary}>
              Undo
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}
