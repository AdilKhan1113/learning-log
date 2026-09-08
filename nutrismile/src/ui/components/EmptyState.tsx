import { View } from 'react-native';
import { Text } from './Text.tsx';
import { palette, spacing } from '../theme/index.ts';

export interface EmptyStateProps {
  title: string;
  body?: string;
  action?: React.ReactNode;
}

/**
 * Shown when there is nothing to show.
 *
 * Copy states the situation and the next action. An empty day is not a lapse
 * and is never described as one.
 */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl }}>
      <Text variant="heading" center>
        {title}
      </Text>
      {body ? (
        <Text variant="body" color={palette.textSecondary} center>
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </View>
  );
}
