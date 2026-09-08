import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { palette, typography } from '../theme/index.ts';

type Variant = keyof typeof typography;

export interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
  center?: boolean;
}

/** Typography-aware Text. Every string in the app goes through this. */
export function Text({
  variant = 'body',
  color = palette.text,
  center,
  style,
  ...rest
}: TextProps) {
  return (
    <RNText
      {...rest}
      style={[
        typography[variant] as object,
        { color },
        center && { textAlign: 'center' as const },
        style,
      ]}
    />
  );
}
