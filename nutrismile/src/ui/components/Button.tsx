import { ActivityIndicator, Pressable, type PressableProps, View } from 'react-native';
import { Text } from './Text.tsx';
import { HIT_SIZE, palette, radius, spacing } from '../theme/index.ts';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  title,
  variant = 'primary',
  loading,
  fullWidth,
  disabled,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const background =
    variant === 'primary'
      ? palette.accent
      : variant === 'secondary'
        ? palette.surfaceRaised
        : 'transparent';
  const color = variant === 'primary' ? palette.accentText : palette.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      {...rest}
      style={({ pressed }) => ({
        minHeight: HIT_SIZE,
        paddingHorizontal: spacing.xl,
        borderRadius: radius.pill,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: fullWidth ? 'stretch' : 'flex-start',
        opacity: isDisabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <View>
          <Text variant="label" color={color}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
