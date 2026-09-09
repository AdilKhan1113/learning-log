/**
 * Profile. Shows the target and the workings behind it, so a number the app
 * chose can be understood rather than just accepted.
 */
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { Card } from '../../src/ui/components/Card.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { TAB_BAR_HEIGHT, palette, radius, spacing } from '../../src/ui/theme/index.ts';
import { useSession } from '../../src/state/session.ts';
import { listMissing, macroPercentages } from '../../src/domain/nutrition/goals.ts';
import {
  type Suggestion,
  useRecalculateTarget,
} from '../../src/features/profile/useRecalculateTarget.ts';
import type { DailyGoal } from '../../src/db/repositories/goals.ts';
import { type SyncState, useSync } from '../../src/state/sync.ts';
import { requestDeletionCode } from '../../src/services/supabase/client.ts';
import { formatGrams, formatKcal } from '../../src/utils/format.ts';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const profile = useSession((s) => s.profile);
  const goal = useSession((s) => s.goal);
  const refresh = useSession((s) => s.refresh);
  const recalculate = useRecalculateTarget(profile);
  const sync = useSync();
  const router = useRouter();
  const reloadSession = useSession((s) => s.load);

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

      <SyncCard sync={sync} userId={profile?.id ?? null} />

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

      <DeleteAccountCard
        onDeleted={async () => {
          // Back to a first-launch app: the profile is gone, so the root
          // layout routes to onboarding once the session reloads.
          await reloadSession();
          router.replace('/onboarding');
        }}
      />
    </ScrollView>
  );
}

/**
 * Deleting the account and all its data.
 *
 * Confirmed twice and never a single tap: this is the one action in the app
 * that cannot be undone. The copy says plainly what goes and what it means,
 * without trying to talk anyone out of it.
 */
function DeleteAccountCard({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  async function getCode() {
    setIssuing(true);
    setError(null);
    const result = await requestDeletionCode();
    if (result.ok) setCode(result.code);
    else setError(result.message);
    setIssuing(false);
  }

  function confirm() {
    Alert.alert(
      'Delete everything?',
      'Your foods, meals, weight and targets will be removed from this device and from the cloud. This cannot be undone.',
      [
        { text: 'Keep my data', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError(null);
            const result = await sync.deleteEverything();
            if (result.ok) {
              await onDeleted();
            } else {
              setError(result.message);
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <Text variant="heading">Delete your data</Text>
      <Text variant="body" color={palette.textSecondary}>
        Removes everything you've logged, from this device and from the cloud,
        and deletes the account. There's no way to get it back.
      </Text>
      {error ? (
        <Text variant="body" color={palette.error}>
          {error}
        </Text>
      ) : null}
      <Button
        title="Delete everything"
        variant="secondary"
        fullWidth
        loading={busy}
        onPress={confirm}
      />

      {/* The account is anonymous, so nothing about it identifies its owner.
          This code is what makes deletion possible from a browser later —
          after the phone is gone, when there is no app to press a button in. */}
      {code ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="label">Your deletion code</Text>
          <View
            style={{
              padding: spacing.md,
              borderRadius: radius.md,
              backgroundColor: palette.surfaceRaised,
            }}
          >
            <Text variant="body" selectable style={{ letterSpacing: 1 }}>
              {code}
            </Text>
          </View>
          <Text variant="caption" color={palette.textSecondary}>
            Save this somewhere safe. It deletes your data from the website even
            if you lose the app, and it can't be shown again — asking for
            another replaces this one.
          </Text>
        </View>
      ) : (
        <Button
          title="Get a deletion code"
          variant="ghost"
          fullWidth
          loading={issuing}
          onPress={getCode}
        />
      )}
    </Card>
  );
}

/**
 * Cloud backup status.
 *
 * Quiet by design: this is a convenience, not a feature the user has to manage.
 * The app works fully offline, so a problem here is a line of status text and
 * never an error the user has to dismiss.
 */
function SyncCard({
  sync,
  userId,
}: {
  sync: SyncState;
  userId: string | null;
}) {
  if (sync.status === 'disabled') {
    return (
      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">Backup</Text>
        <Text variant="body" color={palette.textSecondary}>
          Your data lives on this device. Cloud backup isn't set up, so nothing
          leaves the phone.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <Text variant="heading">Backup</Text>

      <Text variant="body" color={palette.textSecondary}>
        {describeSync(sync)}
      </Text>

      {sync.pending > 0 ? (
        <Text variant="caption" color={palette.textTertiary}>
          {sync.pending} {sync.pending === 1 ? 'change' : 'changes'} waiting to upload.
          They'll go when there's a connection.
        </Text>
      ) : null}

      <Button
        title="Back up now"
        variant="secondary"
        fullWidth
        loading={sync.status === 'syncing'}
        disabled={!userId}
        onPress={() => {
          if (userId) void sync.syncNow(userId);
        }}
      />
    </Card>
  );
}

/** Neutral status text. Being offline is a state, not a problem. */
function describeSync(sync: SyncState): string {
  switch (sync.status) {
    case 'syncing':
      return 'Backing up…';
    case 'error':
      return sync.message
        ? `Not backed up yet: ${sync.message} Your data is safe on this device.`
        : 'Not backed up yet. Your data is safe on this device.';
    case 'signed_out':
      return 'Setting up backup…';
    case 'idle':
      return sync.lastSyncedAt
        ? `Backed up ${describeWhen(sync.lastSyncedAt)}.`
        : 'Ready to back up.';
    default:
      return 'Your data lives on this device.';
  }
}

function describeWhen(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return new Date(timestamp).toLocaleDateString();
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
