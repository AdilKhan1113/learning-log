/**
 * Scan. Camera, barcode, lookup.
 *
 * Every state the camera can be in is handled explicitly: permission not yet
 * asked, permission refused, and permission granted. A refusal is a decision
 * the user is entitled to make, so it is met with the alternative rather than
 * with nagging.
 *
 * Photo estimation joins this screen in Phase 4.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { Card } from '../../src/ui/components/Card.tsx';
import { HIT_SIZE, TAB_BAR_HEIGHT, palette, spacing } from '../../src/ui/theme/index.ts';
import { useBarcodeLookup } from '../../src/features/scanner/useBarcodeLookup.ts';
import { ScannerOverlay } from '../../src/features/scanner/ScannerOverlay.tsx';
import { useMealEstimate } from '../../src/features/photo/useMealEstimate.ts';
import { EstimateReview } from '../../src/features/photo/EstimateReview.tsx';
import { useSession } from '../../src/state/session.ts';

/** The symbologies on food packaging. Narrowing this list keeps the decoder
 *  from spending time on QR and postal codes that will never be food. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14'] as const;

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const { state, handleScan, reset } = useBarcodeLookup();
  const [active, setActive] = useState(true);
  const profile = useSession((s) => s.profile);
  const photo = useMealEstimate();

  // Stop the camera when the tab is left. A camera running behind another
  // screen drains the battery and shows a recording indicator for no reason.
  //
  // Depends on the individual reset functions rather than the objects holding
  // them: a hook's return value is a new object on every render, so depending
  // on it re-subscribes this effect every render, and its cleanup then sets
  // state, which renders again. That loop is what "Maximum update depth
  // exceeded" means.
  const resetPhoto = photo.reset;
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => {
        setActive(false);
        reset();
        resetPhoto();
      };
    }, [reset, resetPhoto]),
  );

  // The photo flow takes over the whole screen once it starts: an estimate
  // being reviewed must not sit behind a running camera.
  if (photo.stage.status !== 'idle') {
    return (
      <PhotoFlow
        photo={photo}
        insetTop={insets.top}
        insetBottom={insets.bottom}
        userId={profile?.id ?? null}
        onDone={() => router.push('/')}
        onSearchInstead={() => {
          photo.reset();
          router.push('/log');
        }}
      />
    );
  }

  if (!permission) {
    // Permissions are still being read; nothing useful to show yet.
    return <View style={{ flex: 1, backgroundColor: palette.background }} />;
  }

  if (!permission.granted) {
    return (
      <PermissionScreen
        insetTop={insets.top}
        canAskAgain={permission.canAskAgain}
        onRequest={requestPermission}
        onManualEntry={() => router.push('/log')}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {active ? (
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
          onBarcodeScanned={
            // Only listen while there is nothing on screen to act on, so the
            // scanner cannot replace a result the user is still reading.
            state.status === 'idle'
              ? ({ data }) => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  void handleScan(data);
                }
              : undefined
          }
        />
      ) : null}

      <View style={{ ...StyleSheetAbsoluteFill, paddingTop: insets.top }}>
        <ScannerOverlay
          state={state}
          onLogFood={(foodId) => {
            reset();
            router.push(`/modals/log-food?foodId=${foodId}`);
          }}
          onCreateFood={(barcode, partial) => {
            reset();
            const params = new URLSearchParams({ barcode });
            if (partial?.name) params.set('name', partial.name);
            if (partial?.brand) params.set('brand', partial.brand);
            if (partial?.basisUnit) params.set('basis', partial.basisUnit);
            // Energy is never prefilled: it was missing or implausible, and a
            // wrong number already in the field is worse than an empty one.
            if (partial?.proteinGPer100 != null) params.set('protein', String(partial.proteinGPer100));
            if (partial?.carbsGPer100 != null) params.set('carbs', String(partial.carbsGPer100));
            if (partial?.fatGPer100 != null) params.set('fat', String(partial.fatGPer100));
            router.push(`/modals/create-food?${params.toString()}`);
          }}
          onScanAgain={reset}
        />

        {/* Photo estimation lives alongside the barcode scanner rather than on
            its own tab: both answer "what am I about to eat", and the fewest
            taps to a logged meal is the point of the whole screen. */}
        <View
          style={{
            position: 'absolute',
            left: spacing.lg,
            right: spacing.lg,
            top: spacing.md,
            flexDirection: 'row',
            justifyContent: 'center',
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Estimate a meal from a photo"
            onPress={() => void photo.captureAndEstimate('camera')}
            style={({ pressed }) => ({
              minHeight: HIT_SIZE,
              paddingHorizontal: spacing.xl,
              justifyContent: 'center',
              borderRadius: 999,
              backgroundColor: palette.surface,
              opacity: pressed ? 0.7 : 0.92,
            })}
          >
            <Text variant="label">Photograph a meal instead</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * The photo path: estimating, reviewing, or explaining why it could not run.
 */
function PhotoFlow({
  photo,
  insetTop,
  insetBottom,
  userId,
  onDone,
  onSearchInstead,
}: {
  photo: ReturnType<typeof useMealEstimate>;
  insetTop: number;
  insetBottom: number;
  userId: string | null;
  onDone: () => void;
  onSearchInstead: () => void;
}) {
  const { stage } = photo;

  if (stage.status === 'estimating') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: palette.background,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.lg,
          padding: spacing.xl,
        }}
      >
        <ActivityIndicator color={palette.accent} />
        <Text variant="body" color={palette.textSecondary} center>
          Working out what's on the plate. This takes a few seconds.
        </Text>
        <Button title="Cancel" variant="ghost" onPress={photo.reset} />
      </View>
    );
  }

  if (stage.status === 'failed') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: palette.background,
          justifyContent: 'center',
          gap: spacing.lg,
          padding: spacing.xl,
        }}
      >
        <Text variant="heading" center>
          No estimate this time
        </Text>
        <Text variant="body" color={palette.textSecondary} center>
          {stage.message}
        </Text>
        <Button title="Try another photo" fullWidth onPress={() => void photo.captureAndEstimate('camera')} />
        <Button title="Search for it instead" variant="secondary" fullWidth onPress={onSearchInstead} />
        <Button title="Back to scanning" variant="ghost" fullWidth onPress={photo.reset} />
      </View>
    );
  }

  // The caller only renders this once the flow has started, but the idle case
  // has to be handled for the type to narrow to a reviewable estimate.
  if (stage.status !== 'reviewing') return null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      // The tab bar sits over this screen, and the button at the bottom of the
      // review is the one that logs the meal — it must not end up behind it.
      contentContainerStyle={{
        paddingTop: insetTop,
        paddingBottom: TAB_BAR_HEIGHT + insetBottom + spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <EstimateReview
        estimate={stage.estimate}
        saving={photo.saving}
        onSetPortion={photo.setPortion}
        onRemove={photo.removeFood}
        onDiscard={photo.reset}
        onConfirm={async (meal) => {
          if (!userId) return;
          const logged = await photo.confirm(userId, meal);
          if (logged > 0) onDone();
        }}
      />
    </ScrollView>
  );
}

const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

function PermissionScreen({
  insetTop,
  canAskAgain,
  onRequest,
  onManualEntry,
}: {
  insetTop: number;
  canAskAgain: boolean;
  onRequest: () => void;
  onManualEntry: () => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.background,
        paddingTop: insetTop + spacing.lg,
        paddingHorizontal: spacing.lg,
        gap: spacing.xl,
      }}
    >
      <Text variant="title">Scan</Text>

      <Card style={{ gap: spacing.md }}>
        <Text variant="heading">Camera access</Text>
        <Text variant="body" color={palette.textSecondary}>
          Scanning a barcode needs the camera. NutriSmile reads the code and
          looks it up — nothing is recorded or sent anywhere.
        </Text>

        {canAskAgain ? (
          <Button title="Allow camera" fullWidth onPress={onRequest} />
        ) : (
          <>
            <Text variant="body" color={palette.textSecondary}>
              Camera access is currently turned off for NutriSmile. You can turn
              it back on in Settings.
            </Text>
            <Button
              title="Open Settings"
              fullWidth
              onPress={() => {
                void Linking.openSettings();
              }}
            />
          </>
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text variant="heading">Or search instead</Text>
        <Text variant="body" color={palette.textSecondary}>
          Everything you can scan, you can also find by name. The camera is a
          shortcut, not the only way in.
        </Text>
        <Button title="Search foods" variant="secondary" fullWidth onPress={onManualEntry} />
      </Card>

      {Platform.OS === 'web' ? (
        <Text variant="caption" color={palette.textTertiary}>
          Barcode scanning needs a device camera and isn't available here.
        </Text>
      ) : null}
    </View>
  );
}
