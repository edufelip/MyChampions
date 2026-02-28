import { Image } from 'expo-image';
import { Platform, StyleSheet } from 'react-native';

import { HelloWave } from '@/components/hello-wave';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Link } from 'expo-router';
import { useTranslation } from '@/localization';

export default function HomeScreen() {
  const { t } = useTranslation();
  const devtoolsShortcut =
    Platform.select({
      ios: t('shell.token.shortcut.devtools_ios'),
      android: t('shell.token.shortcut.devtools_android'),
      web: t('shell.token.shortcut.devtools_web'),
    }) ?? t('shell.token.shortcut.devtools_web');

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">{t('shell.home.title')}</ThemedText>
        <HelloWave />
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">{t('shell.home.step1.title')}</ThemedText>
        <ThemedText>
          {t('shell.home.step1.part1')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.path.tabs_index')}</ThemedText>{' '}
          {t('shell.home.step1.part2')}{' '}
          <ThemedText type="defaultSemiBold">{devtoolsShortcut}</ThemedText>{' '}
          {t('shell.home.step1.part3')}
        </ThemedText>
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <Link href="/modal">
          <Link.Trigger>
            <ThemedText type="subtitle">{t('shell.home.step2.title')}</ThemedText>
          </Link.Trigger>
          <Link.Preview />
          <Link.Menu>
            <Link.MenuAction
              title={t('shell.home.menu.action')}
              icon="cube"
              onPress={() => alert(t('shell.home.alert.action'))}
            />
            <Link.MenuAction
              title={t('shell.home.menu.share')}
              icon="square.and.arrow.up"
              onPress={() => alert(t('shell.home.alert.share'))}
            />
            <Link.Menu title={t('shell.home.menu.more')} icon="ellipsis">
              <Link.MenuAction
                title={t('shell.home.menu.delete')}
                icon="trash"
                destructive
                onPress={() => alert(t('shell.home.alert.delete'))}
              />
            </Link.Menu>
          </Link.Menu>
        </Link>

        <ThemedText>{t('shell.home.step2.description')}</ThemedText>
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">{t('shell.home.step3.title')}</ThemedText>
        <ThemedText>
          {t('shell.home.step3.part1')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.command.reset_project')}</ThemedText>{' '}
          {t('shell.home.step3.part2')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.path.app')}</ThemedText>
          {t('shell.common.period')}{' '}
          {t('shell.home.step3.part3')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.path.app')}</ThemedText>{' '}
          {t('shell.home.step3.part4')}{' '}
          <ThemedText type="defaultSemiBold">{t('shell.token.path.app_example')}</ThemedText>
          {t('shell.common.period')}
        </ThemedText>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
});
