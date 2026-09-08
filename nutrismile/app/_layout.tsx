/**
 * Root layout.
 *
 * The database is migrated before any screen that queries it renders, and the
 * user is routed to onboarding or to the app depending on whether a profile
 * exists. A migration failure is shown as a real error rather than a blank
 * screen.
 */
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from '../src/ui/components/Text.tsx';
import { Button } from '../src/ui/components/Button.tsx';
import { palette, spacing } from '../src/ui/theme/index.ts';
import { useSession } from '../src/state/session.ts';

/**
 * React Navigation paints every screen with its own theme, and that theme wins
 * over a background set further up the tree. Without this the navigator paints
 * its default light scene behind the app and the dark text disappears into it.
 *
 * Defining it here rather than per-screen means headers, card backgrounds and
 * the gaps between screens during a transition all match too.
 */
const navigationTheme: ReactNavigation.Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: palette.background,
    card: palette.surface,
    text: palette.text,
    border: palette.border,
    primary: palette.accent,
    notification: palette.accent,
  },
};

export default function RootLayout() {
  const { status, profile, error, load } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status !== 'ready') return;
    const inOnboarding = segments[0] === 'onboarding';

    if (!profile?.onboarded && !inOnboarding) {
      router.replace('/onboarding');
    } else if (profile?.onboarded && inOnboarding) {
      router.replace('/');
    }
  }, [status, profile?.onboarded, segments, router]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.background }}>
      <SafeAreaProvider>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style="light" />
          {status === 'error' ? (
            <StartupError message={error} onRetry={() => void load()} />
          ) : status === 'ready' ? (
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: palette.background },
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="modals/log-food" options={{ presentation: 'modal' }} />
              <Stack.Screen name="modals/create-food" options={{ presentation: 'modal' }} />
            </Stack>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={palette.accent} />
            </View>
          )}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function StartupError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.lg,
        padding: spacing.xl,
      }}
    >
      <Text variant="heading" center>
        Your data didn't open
      </Text>
      <Text variant="body" color={palette.textSecondary} center>
        {message ?? 'Something went wrong reading the database on this device.'}
      </Text>
      <Button title="Try again" onPress={onRetry} />
    </View>
  );
}
