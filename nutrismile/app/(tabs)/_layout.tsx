/**
 * Bottom tabs. Scan sits in the middle as a raised button, because it is the
 * shortest path to a logged meal and should be reachable with one thumb.
 */
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { palette, spacing } from '../../src/ui/theme/index.ts';
import { Text } from '../../src/ui/components/Text.tsx';

/** Text glyphs stand in for the icon set until one is chosen. */
function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <Text variant="body" color={focused ? palette.accent : palette.textTertiary}>
      {glyph}
    </Text>
  );
}

function ScanButton({ focused }: { focused: boolean }) {
  return (
    <View
      style={{
        width: 58,
        height: 58,
        borderRadius: 29,
        marginBottom: spacing.xl,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.accent,
        opacity: focused ? 0.85 : 1,
      }}
    >
      <Text variant="title" color={palette.accentText}>
        +
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // The navigator paints behind each tab, so this has to be set here as
        // well as in the navigation theme.
        sceneStyle: { backgroundColor: palette.background },
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textTertiary,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          height: 88,
          paddingTop: spacing.sm,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ focused }) => <TabIcon glyph="◍" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: 'Log',
          tabBarIcon: ({ focused }) => <TabIcon glyph="≡" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: '',
          tabBarIcon: ({ focused }) => <ScanButton focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarIcon: ({ focused }) => <TabIcon glyph="◔" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon glyph="◎" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
