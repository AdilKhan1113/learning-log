/**
 * What sits on top of the camera: a framing window, and the result of the
 * current scan.
 */
import { ActivityIndicator, View } from 'react-native';
import { Text } from '../../ui/components/Text.tsx';
import { Button } from '../../ui/components/Button.tsx';
import { palette, radius, spacing } from '../../ui/theme/index.ts';
import type { ScanState } from './useBarcodeLookup.ts';

import type { PartialFood } from '../../services/openfoodfacts/normalize.ts';

export interface ScannerOverlayProps {
  state: ScanState;
  onLogFood: (foodId: string) => void;
  /** `partial` is whatever the databases knew about a product they could not
   *  give complete nutrition for, so the form opens prefilled. */
  onCreateFood: (barcode: string, partial: PartialFood | null) => void;
  onScanAgain: () => void;
}

/** The window the user aims through. Purely decorative; the camera reads the
 *  whole frame, so a barcode slightly outside it still scans. */
function Reticle() {
  return (
    <View
      style={{
        width: '78%',
        aspectRatio: 1.6,
        borderRadius: radius.lg,
        borderWidth: 2,
        borderColor: palette.accent,
        opacity: 0.9,
      }}
    />
  );
}

export function ScannerOverlay({
  state,
  onLogFood,
  onCreateFood,
  onScanAgain,
}: ScannerOverlayProps) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      {state.status === 'idle' ? (
        <>
          <Reticle />
          <Text
            variant="label"
            color={palette.text}
            center
            style={{ marginTop: spacing.xl, paddingHorizontal: spacing.xl }}
          >
            Point at a barcode
          </Text>
        </>
      ) : null}

      {state.status === 'looking_up' ? (
        <ResultCard>
          <ActivityIndicator color={palette.accent} />
          <Text variant="body" center>
            Looking up {state.barcode}
          </Text>
        </ResultCard>
      ) : null}

      {state.status === 'rejected' ? (
        <ResultCard>
          <Text variant="body" center>
            {state.message}
          </Text>
          <Button title="Scan again" fullWidth onPress={onScanAgain} />
        </ResultCard>
      ) : null}

      {state.status === 'resolved' ? (
        <ResolvedCard
          state={state}
          onLogFood={onLogFood}
          onCreateFood={onCreateFood}
          onScanAgain={onScanAgain}
        />
      ) : null}
    </View>
  );
}

function ResolvedCard({
  state,
  onLogFood,
  onCreateFood,
  onScanAgain,
}: {
  state: Extract<ScanState, { status: 'resolved' }>;
  onLogFood: (foodId: string) => void;
  onCreateFood: (barcode: string, partial: PartialFood | null) => void;
  onScanAgain: () => void;
}) {
  const { outcome } = state;

  if (outcome.kind === 'cached') {
    return (
      <ResultCard>
        <Text variant="heading" center>
          {outcome.name}
        </Text>
        <Button title="Choose a serving" fullWidth onPress={() => onLogFood(outcome.foodId)} />
        <Button title="Scan something else" variant="ghost" fullWidth onPress={onScanAgain} />
      </ResultCard>
    );
  }

  if (outcome.kind === 'found') {
    return (
      <ResultCard>
        <Text variant="heading" center>
          {outcome.food.name}
        </Text>
        {outcome.food.brand ? (
          <Text variant="caption" color={palette.textSecondary} center>
            {outcome.food.brand}
          </Text>
        ) : null}
        <Text variant="caption" color={palette.textTertiary} center>
          {Math.round(outcome.food.kcalPer100)} kcal per 100{outcome.food.basisUnit}
        </Text>
        {/* Cached during the lookup, so it has a local id and is opened
            exactly the way a cache hit is. */}
        <Button title="Choose a serving" fullWidth onPress={() => onLogFood(outcome.foodId)} />
        <Button title="Scan something else" variant="ghost" fullWidth onPress={onScanAgain} />
      </ResultCard>
    );
  }

  if (outcome.kind === 'not_found') {
    return (
      <ResultCard>
        <Text variant="heading" center>
          {outcome.partial?.name ?? 'Not in the food databases'}
        </Text>
        <Text variant="body" color={palette.textSecondary} center>
          {outcome.partial?.name
            ? 'It’s listed, but without nutrition information. Fill it in once and the next scan will have it.'
            : 'Add it once and every future scan of this barcode will find it.'}
        </Text>
        <Button
          title="Add this food"
          fullWidth
          onPress={() => onCreateFood(outcome.barcode, outcome.partial)}
        />
        <Button title="Scan something else" variant="ghost" fullWidth onPress={onScanAgain} />
      </ResultCard>
    );
  }

  return (
    <ResultCard>
      <Text variant="heading" center>
        Couldn't check that barcode
      </Text>
      <Text variant="body" color={palette.textSecondary} center>
        {outcome.reason}
      </Text>
      <Button title="Try again" fullWidth onPress={onScanAgain} />
      <Button
        title="Add it by hand instead"
        variant="ghost"
        fullWidth
        onPress={() => onCreateFood(outcome.barcode, null)}
      />
    </ResultCard>
  );
}

function ResultCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        bottom: spacing.xxl,
        padding: spacing.lg,
        gap: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: palette.surface,
      }}
    >
      {children}
    </View>
  );
}
