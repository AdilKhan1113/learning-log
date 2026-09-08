/**
 * Onboarding: a few questions, then a target the user can accept or change.
 *
 * Every question is answerable in one tap where possible, and the last step
 * shows the suggestion with its reasoning rather than presenting a number as
 * a verdict.
 */
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { Card } from '../../src/ui/components/Card.tsx';
import { HIT_SIZE, palette, radius, spacing } from '../../src/ui/theme/index.ts';
import type { ActivityLevel, GoalType, Sex } from '../../src/domain/types.ts';
import { ACTIVITY_DESCRIPTIONS } from '../../src/domain/nutrition/energy.ts';
import { useOnboarding } from '../../src/features/onboarding/useOnboarding.ts';
import { useSession } from '../../src/state/session.ts';
import { formatGrams, formatKcal } from '../../src/utils/format.ts';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'unspecified', label: 'Prefer not to say' },
];

const ACTIVITY_OPTIONS: ActivityLevel[] = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
];

const GOAL_OPTIONS: { value: GoalType; label: string }[] = [
  { value: 'lose', label: 'Lose weight' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'gain', label: 'Gain weight' },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const refresh = useSession((s) => s.refresh);
  const { draft, update, suggestion, complete, saving, error } = useOnboarding();

  const [birthYear, setBirthYear] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xl,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxxl,
        gap: spacing.xl,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: spacing.sm }}>
        <Text variant="title">Let's set your target</Text>
        <Text variant="body" color={palette.textSecondary}>
          A few details give a starting point. You can change any of it later,
          including the target itself.
        </Text>
      </View>

      <Field label="Year of birth">
        <NumberInput
          value={birthYear}
          onChangeText={(value) => {
            setBirthYear(value);
            const year = Number.parseInt(value, 10);
            update({
              birthDate:
                value.length === 4 && year > 1900 && year < new Date().getFullYear()
                  ? `${year}-01-01`
                  : null,
            });
          }}
          placeholder="1995"
          maxLength={4}
        />
      </Field>

      <Field label="Sex" hint="Used by the equation that estimates your energy needs.">
        <Options
          options={SEX_OPTIONS.map((o) => ({ key: o.value, label: o.label }))}
          selected={draft.sex}
          onSelect={(value) => update({ sex: value as Sex })}
        />
      </Field>

      <Field label="Height">
        <NumberInput
          value={height}
          onChangeText={(value) => {
            setHeight(value);
            const cm = Number.parseFloat(value);
            update({ heightCm: Number.isFinite(cm) && cm > 0 ? cm : null });
          }}
          placeholder="165"
          suffix="cm"
        />
      </Field>

      <Field label="Weight">
        <NumberInput
          value={weight}
          onChangeText={(value) => {
            setWeight(value);
            const kg = Number.parseFloat(value);
            update({ weightKg: Number.isFinite(kg) && kg > 0 ? kg : null });
          }}
          placeholder="65"
          suffix="kg"
        />
      </Field>

      <Field label="Activity">
        <Options
          options={ACTIVITY_OPTIONS.map((level) => ({
            key: level,
            label: ACTIVITY_DESCRIPTIONS[level],
          }))}
          selected={draft.activityLevel}
          onSelect={(value) => update({ activityLevel: value as ActivityLevel })}
        />
      </Field>

      <Field label="Goal">
        <Options
          options={GOAL_OPTIONS.map((o) => ({ key: o.value, label: o.label }))}
          selected={draft.goalType}
          onSelect={(value) => update({ goalType: value as GoalType })}
        />
      </Field>

      {suggestion ? (
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading">Your starting target</Text>
          <Text variant="display">{formatKcal(suggestion.calorieTarget)}</Text>
          <Text variant="caption" color={palette.textSecondary}>
            {formatGrams(suggestion.proteinGTarget)} protein ·{' '}
            {formatGrams(suggestion.carbsGTarget)} carbs ·{' '}
            {formatGrams(suggestion.fatGTarget)} fat
          </Text>
          {suggestion.floorApplied ? (
            <Text variant="caption" color={palette.textSecondary}>
              This is the lowest target NutriSmile sets, so it's above what the
              rate you picked would give on its own.
            </Text>
          ) : null}
          {suggestion.proteinCapped ? (
            <Text variant="caption" color={palette.textSecondary}>
              Protein is held to about a third of your calories here, leaving
              more room for carbs and fat. You can change the split any time.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {error ? (
        <Text variant="body" color={palette.error}>
          {error}
        </Text>
      ) : null}

      <Button
        title="Start logging"
        fullWidth
        loading={saving}
        disabled={!suggestion}
        onPress={async () => {
          const id = await complete();
          if (!id) return;
          await refresh();
          router.replace('/');
        }}
      />
    </ScrollView>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="label">{label}</Text>
      {hint ? (
        <Text variant="caption" color={palette.textTertiary}>
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function NumberInput({
  value,
  onChangeText,
  placeholder,
  suffix,
  maxLength,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  suffix?: string;
  maxLength?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textTertiary}
        keyboardType="numeric"
        maxLength={maxLength}
        style={{
          flex: 1,
          minHeight: HIT_SIZE,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.border,
          color: palette.text,
          fontSize: 18,
        }}
      />
      {suffix ? (
        <Text variant="body" color={palette.textSecondary}>
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

function Options({
  options,
  selected,
  onSelect,
}: {
  options: { key: string; label: string }[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      {options.map((option) => {
        const isSelected = option.key === selected;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(option.key)}
            style={{
              minHeight: HIT_SIZE,
              justifyContent: 'center',
              paddingHorizontal: spacing.lg,
              borderRadius: radius.md,
              backgroundColor: isSelected ? palette.accentMuted : palette.surface,
              borderWidth: 1,
              borderColor: isSelected ? palette.accent : palette.border,
            }}
          >
            <Text variant="body" color={isSelected ? palette.accent : palette.text}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
