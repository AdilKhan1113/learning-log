import { View, type ViewProps } from 'react-native';
import { palette, radius, spacing } from '../theme/index.ts';

export interface CardProps extends ViewProps {
  padded?: boolean;
  raised?: boolean;
}

export function Card({ padded = true, raised, style, ...rest }: CardProps) {
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: raised ? palette.surfaceRaised : palette.surface,
          borderRadius: radius.lg,
          padding: padded ? spacing.lg : 0,
        },
        style,
      ]}
    />
  );
}
