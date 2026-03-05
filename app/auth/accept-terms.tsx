import { Stack } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation, type TranslationKey } from '@/localization';

export default function AcceptTermsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { t } = useTranslation();
  const { acceptTerms, termsUrl, termsRequiredVersion } = useAuthSession();

  const [isChecked, setIsChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const onOpenTerms = async () => {
    setErrorKey(null);

    try {
      const supported = await Linking.canOpenURL(termsUrl);
      if (!supported) {
        setErrorKey('auth.terms.error.link_unavailable');
        return;
      }

      await Linking.openURL(termsUrl);
    } catch {
      setErrorKey('auth.terms.error.link_unavailable');
    }
  };

  const onAccept = async () => {
    if (!isChecked || submitting) {
      return;
    }

    setErrorKey(null);
    setSubmitting(true);
    try {
      await acceptTerms();
    } catch {
      setErrorKey('common.error.generic');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#221410' : '#fff5f0' }]}>
      <Stack.Screen options={{ title: t('auth.terms.title'), headerShown: false }} />

      <View
        pointerEvents="none"
        style={[
          styles.blob,
          styles.blobTopLeft,
          { backgroundColor: isDark ? '#5f4f29' : '#ffeca1' },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.blob,
          styles.blobBottomRight,
          { backgroundColor: isDark ? '#2e5b4a' : '#a1e8cc' },
        ]}
      />

      <View style={styles.content}>
        <View style={styles.titleArea}>
          <View style={[styles.badge, { backgroundColor: isDark ? '#2a1f1b' : '#ffffff' }]}>
            <MaterialIcons color="#ff7b72" name="gavel" size={30} />
          </View>
          <Text style={[styles.title, { color: palette.text }]}>{t('auth.terms.title')}</Text>
          <Text style={[styles.subtitle, { color: palette.icon }]}>{t('auth.terms.description')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: isDark ? '#2a1f1b' : '#ffffff' }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('auth.terms.open_link')}
            onPress={onOpenTerms}
            style={({ pressed }) => [
              styles.linkButton,
              {
                borderColor: isDark ? '#4a3a33' : '#ffd6d1',
                backgroundColor: pressed ? 'rgba(255,123,114,0.1)' : 'transparent',
              },
            ]}>
            <MaterialIcons color="#ff7b72" name="open-in-new" size={20} />
            <Text style={styles.linkButtonText}>{t('auth.terms.open_link')}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isChecked }}
            onPress={() => setIsChecked((prev) => !prev)}
            style={styles.checkboxRow}>
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: isChecked ? '#ff7b72' : isDark ? '#6b5549' : '#e2d7d2',
                  backgroundColor: isChecked ? '#ff7b72' : 'transparent',
                },
              ]}>
              {isChecked ? <MaterialIcons color="#ffffff" name="check" size={15} /> : null}
            </View>
            <Text style={[styles.checkboxLabel, { color: palette.text }]}> {t('auth.terms.checkbox')}</Text>
          </Pressable>

          <Text style={[styles.versionText, { color: palette.icon }]}>
            {t('auth.terms.version', { version: termsRequiredVersion })}
          </Text>

          {errorKey ? (
            <View accessibilityLiveRegion="polite">
              <Text style={styles.errorText}>{t(errorKey)}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !isChecked || submitting }}
            disabled={!isChecked || submitting}
            onPress={onAccept}
            style={({ pressed }) => [
              styles.acceptButton,
              {
                opacity: !isChecked || submitting ? 0.6 : pressed ? 0.92 : 1,
              },
            ]}>
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.acceptButtonText}>{t('auth.terms.accept_button')}</Text>
            )}
          </Pressable>

          <Text style={[styles.offlineHint, { color: palette.icon }]}>{t('auth.terms.offline_hint')}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    opacity: 0.6,
    zIndex: 0,
  },
  blobTopLeft: {
    top: '-10%',
    left: '-18%',
    width: 260,
    height: 260,
    borderRadius: 120,
  },
  blobBottomRight: {
    bottom: '-8%',
    right: '-20%',
    width: 300,
    height: 300,
    borderRadius: 140,
  },
  content: {
    zIndex: 1,
    gap: 20,
  },
  titleArea: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  badge: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,123,114,0.25)',
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  card: {
    borderRadius: 32,
    padding: 20,
    gap: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  linkButton: {
    minHeight: 52,
    borderWidth: 2,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  linkButtonText: {
    color: '#ff7b72',
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  versionText: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#ef4444',
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  acceptButton: {
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: '#ff7b72',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ff7b72',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 4,
  },
  acceptButtonText: {
    color: '#ffffff',
    fontFamily: Fonts.sans,
    fontSize: 17,
    fontWeight: '800',
  },
  offlineHint: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
