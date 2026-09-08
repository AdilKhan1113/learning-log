/**
 * Log. Search, recents and favourites, plus the path to a custom food.
 *
 * Opening with no query shows recents, because the fastest log is one the user
 * has made before.
 */
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/ui/components/Text.tsx';
import { EmptyState } from '../../src/ui/components/EmptyState.tsx';
import { Button } from '../../src/ui/components/Button.tsx';
import { HIT_SIZE, palette, radius, spacing } from '../../src/ui/theme/index.ts';
import type { Meal } from '../../src/domain/types.ts';
import { useSession } from '../../src/state/session.ts';
import { useFoodSearch } from '../../src/features/logging/useFoodSearch.ts';
import { formatKcal } from '../../src/utils/format.ts';

export default function LogScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ meal?: string }>();
  const meal = (params.meal as Meal) ?? 'snacks';

  const profile = useSession((s) => s.profile);
  const { query, setQuery, mode, results, loading, remoteStatus, remoteNotice, error, reload } =
    useFoodSearch(profile?.id ?? null);
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ flex: 1, paddingTop: insets.top + spacing.lg }}>
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
        <Text variant="title">Log food</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search foods"
          placeholderTextColor={palette.textTertiary}
          autoCorrect={false}
          accessibilityLabel="Search foods"
          style={{
            minHeight: HIT_SIZE,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.md,
            backgroundColor: palette.surface,
            borderWidth: 1,
            borderColor: focused ? palette.accent : palette.border,
            color: palette.text,
            fontSize: 16,
          }}
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          paddingBottom: spacing.xxxl,
        }}
        ListHeaderComponent={
          <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
            {mode === 'recent' && results.length > 0 ? (
              <Text variant="caption" color={palette.textSecondary}>
                Recent
              </Text>
            ) : null}
            {remoteNotice ? (
              <Text variant="caption" color={palette.textSecondary}>
                {remoteNotice}
              </Text>
            ) : null}
          </View>
        }
        ListFooterComponent={
          remoteStatus === 'searching' ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingVertical: spacing.lg,
              }}
            >
              <ActivityIndicator color={palette.textTertiary} size="small" />
              <Text variant="caption" color={palette.textTertiary}>
                Searching the food database
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={palette.accent} style={{ marginTop: spacing.xl }} />
          ) : error ? (
            <EmptyState
              title="Search didn't run"
              body={error}
              action={<Button title="Try again" variant="secondary" onPress={() => void reload()} />}
            />
          ) : remoteStatus === 'searching' ? null : query.trim() ? (
            <EmptyState
              title={`No matches for "${query.trim()}"`}
              body={
                remoteStatus === 'failed'
                  ? 'Your own foods had no match, and the food database is out of reach right now. You can add it yourself.'
                  : "Nothing in your foods or the food database. You can add it and it'll be there next time."
              }
              action={
                <Button
                  title="Create a food"
                  onPress={() =>
                    router.push(
                      `/modals/create-food?meal=${meal}&name=${encodeURIComponent(query.trim())}`,
                    )
                  }
                />
              }
            />
          ) : (
            <EmptyState
              title="Nothing logged yet"
              body="Foods you log will show up here for one-tap reuse."
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}. ${formatKcal(item.kcalPer100)} calories per 100${item.basisUnit}.`}
            onPress={() => router.push(`/modals/log-food?foodId=${item.id}&meal=${meal}`)}
            style={({ pressed }) => ({
              minHeight: HIT_SIZE + 8,
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: palette.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body" numberOfLines={1}>
                {item.name}
              </Text>
              <Text variant="caption" color={palette.textTertiary}>
                {formatKcal(item.kcalPer100)} kcal per 100{item.basisUnit}
                {item.brand ? ` · ${item.brand}` : ''}
              </Text>
            </View>
            {item.isFavorite ? (
              <Text variant="caption" color={palette.accent}>
                ★
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
