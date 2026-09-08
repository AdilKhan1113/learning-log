/**
 * Progress. Weight trend, weekly and monthly charts and the streak counter
 * arrive in Phase 5; the data they read is already being recorded.
 */
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { Card } from '../../src/ui/components/Card.tsx';
import { palette, spacing } from '../../src/ui/theme/index.ts';

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.background,
        paddingTop: insets.top + spacing.lg,
        paddingHorizontal: spacing.lg,
        gap: spacing.xl,
      }}
    >
      <Text variant="title">Progress</Text>
      <Card style={{ gap: spacing.md }}>
        <Text variant="body" color={palette.textSecondary}>
          Weight trend, weekly and monthly averages, and days logged arrive in
          Phase 5. Your weight and every entry are already being recorded, so
          the charts will have history to show when they land.
        </Text>
      </Card>
    </View>
  );
}
