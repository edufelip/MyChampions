import { StyleSheet, Text } from 'react-native';

import { DsTypography, type DsColorScheme, getDsTheme } from '@/constants/design-system';

import { DsCard } from '../primitives/DsCard';

type ReadOnlyNoticeCardProps = {
  scheme: DsColorScheme;
  text: string;
  testID?: string;
};

export function ReadOnlyNoticeCard({ scheme, text, testID }: ReadOnlyNoticeCardProps) {
  const theme = getDsTheme(scheme);

  return (
    <DsCard scheme={scheme} variant="warning" testID={testID}>
      <Text style={[styles.text, { color: theme.color.readOnlyText }]}>{text}</Text>
    </DsCard>
  );
}

const styles = StyleSheet.create({
  text: {
    ...DsTypography.caption,
    fontWeight: '600',
  },
});
