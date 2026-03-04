import { StyleSheet, View } from 'react-native';

import { type DsColorScheme, getDsTheme } from '@/constants/design-system';

type DsBlobBackgroundProps = {
  scheme: DsColorScheme;
  topLeft?: {
    top: number;
    left: number;
    size: number;
  };
  bottomRight?: {
    bottom: number;
    right: number;
    size: number;
  };
};

export function DsBlobBackground({
  scheme,
  topLeft = { top: -70, left: -110, size: 300 },
  bottomRight = { bottom: -80, right: -130, size: 340 },
}: DsBlobBackgroundProps) {
  const theme = getDsTheme(scheme);

  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.blob,
          {
            backgroundColor: theme.blob.topLeft,
            top: topLeft.top,
            left: topLeft.left,
            width: topLeft.size,
            height: topLeft.size,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.blob,
          {
            backgroundColor: theme.blob.bottomRight,
            bottom: bottomRight.bottom,
            right: bottomRight.right,
            width: bottomRight.size,
            height: bottomRight.size,
          },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  blob: {
    borderRadius: 999,
    opacity: 0.6,
    position: 'absolute',
  },
});
