import { Image } from 'expo-image';
import { Platform, StyleSheet } from 'react-native';

import { Collapsible } from '@/components/ui/collapsible';
import { ExternalLink } from '@/components/external-link';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Fonts } from '@/constants/theme';
import { useTranslation } from '@/localization';

export default function TabTwoScreen() {
  const { t } = useTranslation();

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={
        <IconSymbol
          size={310}
          color="#808080"
          name="chevron.left.forwardslash.chevron.right"
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText
          type="title"
          style={{
            fontFamily: Fonts.rounded,
          }}>
          {t('shell.explore.title')}
        </ThemedText>
      </ThemedView>
      <ThemedText>{t('shell.explore.description')}</ThemedText>
      <Collapsible title={t('shell.explore.section.routing.title')}>
        <ThemedText>
          {t('shell.explore.section.routing.line1.part1')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.path.tabs_index')}</ThemedText>{' '}
          {t('shell.explore.section.routing.line1.part2')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.path.tabs_explore')}</ThemedText>
          {t('shell.explore.section.routing.line1.part3')}
        </ThemedText>
        <ThemedText>
          {t('shell.explore.section.routing.line2.part1')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.path.tabs_layout')}</ThemedText>{' '}
          {t('shell.explore.section.routing.line2.part2')}
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/router/introduction">
          <ThemedText type="link">{t('shell.explore.section.routing.learn_more')}</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title={t('shell.explore.section.platform.title')}>
        <ThemedText>
          {t('shell.explore.section.platform.body.part1')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.shortcut.open_web')}</ThemedText>{' '}
          {t('shell.explore.section.platform.body.part2')}
        </ThemedText>
      </Collapsible>
      <Collapsible title={t('shell.explore.section.images.title')}>
        <ThemedText>
          {t('shell.explore.section.images.body.part1')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.image_suffix.2x')}</ThemedText>{' '}
          {t('shell.explore.section.images.body.part2')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.image_suffix.3x')}</ThemedText>{' '}
          {t('shell.explore.section.images.body.part3')}
        </ThemedText>
        <Image
          source={require('@/assets/images/react-logo.png')}
          style={{ width: 100, height: 100, alignSelf: 'center' }}
        />
        <ExternalLink href="https://reactnative.dev/docs/images">
          <ThemedText type="link">{t('shell.explore.section.images.learn_more')}</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title={t('shell.explore.section.theme.title')}>
        <ThemedText>
          {t('shell.explore.section.theme.body.part1')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.hook.use_color_scheme')}</ThemedText>{' '}
          {t('shell.explore.section.theme.body.part2')}
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/develop/user-interface/color-themes/">
          <ThemedText type="link">{t('shell.explore.section.theme.learn_more')}</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title={t('shell.explore.section.animations.title')}>
        <ThemedText>
          {t('shell.explore.section.animations.body.part1')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.path.components_hello_wave')}</ThemedText>{' '}
          {t('shell.explore.section.animations.body.part2')}{' '}
          <ThemedText type="defaultSemiBold" style={{ fontFamily: Fonts.mono }}>
            {t('shell.token.library.react_native_reanimated')}
          </ThemedText>{' '}
          {t('shell.explore.section.animations.body.part3')}
        </ThemedText>
        {Platform.select({
          ios: (
            <ThemedText>
              {t('shell.explore.section.animations.ios_extra.part1')}{' '}
              <ThemedText type="defaultSemiBold">
                {t('shell.token.path.components_parallax_scroll_view')}
              </ThemedText>{' '}
              {t('shell.explore.section.animations.ios_extra.part2')}
            </ThemedText>
          ),
        })}
      </Collapsible>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
});
