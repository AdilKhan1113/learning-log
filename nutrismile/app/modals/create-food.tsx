/**
 * Creating a custom food.
 *
 * Reached when a search finds nothing, prefilled with whatever was typed, and
 * in Phase 3 it will also be reached from a barcode that matched nothing —
 * prefilled with whatever the lookup did return.
 *
 * Values are entered per 100 g or per 100 ml because that is how labels are
 * printed and how the app stores them, and an optional serving size becomes a
 * named portion so the food can be logged by the serving afterwards.
 */
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '../../src/ui/components/Text.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { HIT_SIZE, palette, radius, spacing } from '../../src/ui/theme/index.ts';
import type { BasisUnit, Meal } from '../../src/domain/types.ts';
import { foods } from '../../src/db/repositories/index.ts';
import { useSession } from '../../src/state/session.ts';

/** Parsed number, or null when the field is empty or not a number. */
function parseField(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export default function CreateFoodModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string; meal?: string; barcode?: string }>();
  const profile = useSession((s) => s.profile);
  const meal = (params.meal as Meal) ?? 'snacks';

  const [name, setName] = useState(params.name ?? '');
  const [brand, setBrand] = useState('');
  const [basisUnit, setBasisUnit] = useState<BasisUnit>('g');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [serving, setServing] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kcalValue = parseField(kcal);
  const canSave = name.trim().length > 0 && kcalValue !== null;

  async function save() {
    if (!profile || !canSave || kcalValue === null) return;
    setSaving(true);
    setError(null);

    try {
      const servingAmount = parseField(serving);
      const id = await foods.create({
        userId: profile.id,
        name: name.trim(),
        brand: brand.trim() || null,
        basisUnit,
        kcalPer100: kcalValue,
        proteinGPer100: parseField(protein) ?? 0,
        carbsGPer100: parseField(carbs) ?? 0,
        fatGPer100: parseField(fat) ?? 0,
        barcode: params.barcode ?? null,
        portions:
          servingAmount && servingAmount > 0
            ? [
                {
                  label: `1 serving (${servingAmount}${basisUnit})`,
                  amountInBasis: servingAmount,
                  isDefault: true,
                },
              ]
            : [],
      });

      // Straight into the serving sheet, so creating a food and logging it is
      // one continuous action rather than two trips through search.
      router.replace(`/modals/log-food?foodId=${id}&meal=${meal}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that food.');
      setSaving(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxxl }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: spacing.xs }}>
        <Text variant="title">New food</Text>
        <Text variant="body" color={palette.textSecondary}>
          Saved to your foods, so it's one tap next time.
        </Text>
      </View>

      <Field label="Name">
        <Input value={name} onChangeText={setName} placeholder="Porridge oats" autoFocus />
      </Field>

      <Field label="Brand" optional>
        <Input value={brand} onChangeText={setBrand} placeholder="Quaker" />
      </Field>

      <Field label="Nutrition is per">
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {(['g', 'ml'] as const).map((unit) => {
            const selected = unit === basisUnit;
            return (
              <Pressable
                key={unit}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setBasisUnit(unit)}
                style={{
                  flex: 1,
                  minHeight: HIT_SIZE,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.md,
                  backgroundColor: selected ? palette.accentMuted : palette.surface,
                  borderWidth: 1,
                  borderColor: selected ? palette.accent : palette.border,
                }}
              >
                <Text variant="body" color={selected ? palette.accent : palette.text}>
                  100 {unit}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field label={`Calories per 100 ${basisUnit}`}>
        <Input value={kcal} onChangeText={setKcal} placeholder="379" numeric suffix="kcal" />
      </Field>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Field label="Protein" style={{ flex: 1 }} optional>
          <Input value={protein} onChangeText={setProtein} placeholder="13" numeric suffix="g" />
        </Field>
        <Field label="Carbs" style={{ flex: 1 }} optional>
          <Input value={carbs} onChangeText={setCarbs} placeholder="67" numeric suffix="g" />
        </Field>
        <Field label="Fat" style={{ flex: 1 }} optional>
          <Input value={fat} onChangeText={setFat} placeholder="8" numeric suffix="g" />
        </Field>
      </View>

      <Field
        label="Serving size"
        optional
        hint={`Adds "1 serving" as a unit you can log by.`}
      >
        <Input value={serving} onChangeText={setServing} placeholder="40" numeric suffix={basisUnit} />
      </Field>

      {error ? (
        <Text variant="body" color={palette.error}>
          {error}
        </Text>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <Button title="Save and log it" fullWidth loading={saving} disabled={!canSave} onPress={save} />
        <Button title="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}

function Field({
  label,
  hint,
  optional,
  style,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  style?: object;
  children: React.ReactNode;
}) {
  return (
    <View style={[{ gap: spacing.sm }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
        <Text variant="label">{label}</Text>
        {optional ? (
          <Text variant="caption" color={palette.textTertiary}>
            optional
          </Text>
        ) : null}
      </View>
      {hint ? (
        <Text variant="caption" color={palette.textTertiary}>
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function Input({
  value,
  onChangeText,
  placeholder,
  numeric,
  suffix,
  autoFocus,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
  suffix?: string;
  autoFocus?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textTertiary}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        autoFocus={autoFocus}
        accessibilityLabel={placeholder}
        style={{
          flex: 1,
          minHeight: HIT_SIZE,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.border,
          color: palette.text,
          fontSize: 16,
        }}
      />
      {suffix ? (
        <Text variant="caption" color={palette.textSecondary}>
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}
