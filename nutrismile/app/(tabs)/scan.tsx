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
import { Linking, Platform, Pressable, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { Card } from '../../src/ui/components/Card.tsx';
import { palette, spacing } from '../../src/ui/theme/index.ts';
import { useBarcodeLookup } from '../../src/features/scanner/useBarcodeLookup.ts';
import { ScannerOverlay } from '../../src/features/scanner/ScannerOverlay.tsx';

/** The symbologies on food packaging. Narrowing this list keeps the decoder
 *  from spending time on QR and postal codes that will never be food. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14'] as const;

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const { state, handleScan, reset } = useBarcodeLookup();
  const [active, setActive] = useState(true);

  // Stop the camera when the tab is left. A camera running behind another
  // screen drains the battery and shows a recording indicator for no reason.
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => {
        setActive(false);
        reset();
      };
    }, [reset]),
  );

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
      </View>
    </View>
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
