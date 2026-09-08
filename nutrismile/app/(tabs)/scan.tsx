/**
 * Scan. The camera work lands in Phase 3 (barcode) and Phase 4 (photo).
 *
 * Until then this states plainly what the button will do rather than opening a
 * camera that cannot yet log anything.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { Card } from '../../src/ui/components/Card.tsx';
import { palette, spacing } from '../../src/ui/theme/index.ts';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top + spacing.lg,
        paddingHorizontal: spacing.lg,
        gap: spacing.xl,
      }}
    >
      <Text variant="title">Scan</Text>

      <Card style={{ gap: spacing.md }}>
        <Text variant="heading">Barcode scanning</Text>
        <Text variant="body" color={palette.textSecondary}>
          Point the camera at a barcode and NutriSmile fills in the nutrition
          from Open Food Facts. Arriving in Phase 3.
        </Text>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text variant="heading">Photo estimates</Text>
        <Text variant="body" color={palette.textSecondary}>
          Photograph a meal to get an editable estimate of what's in it. You'll
          confirm every line before anything is logged. Arriving in Phase 4.
        </Text>
      </Card>

      <Button title="Log a food instead" fullWidth onPress={() => router.push('/log')} />
    </View>
  );
}
