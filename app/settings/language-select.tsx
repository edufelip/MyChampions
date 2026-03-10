/**
 * SC-222 Language Select
 * Route: /settings/language-select
 *
 * Dedicated screen for choosing the in-app language. Pushed from the Account /
 * Profile settings screen (SC-213) in place of the former inline native picker
 * (ActionSheetIOS / Alert.alert).
 *
 * Behavior:
 *   - Displays the three supported locales as radio-style rows.
 *   - The currently active locale (from LocaleContext) is pre-selected.
 *   - Tapping a row updates `pendingLocale` local state (no immediate save).
 *   - The Save button (header right) is enabled only when the pending locale
 *     differs from the currently active locale.
 *   - On Save: calls `setActiveLocale(pendingLocale)` → persists to AsyncStorage
 *     + refreshes all app strings in-session → navigates back via `router.back()`.
 *   - Back button (header left) discards pending changes and returns to SC-213.
 *
 * Docs: docs/screens/v2/SC-222-language-select.md
 * Refs: FR-227, D-144 (superseded behavior), D-155
 */
import { useState } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DsRadius, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SUPPORTED_LOCALES, type SupportedLocale, useTranslation } from '@/localization';
import { useLocale } from '@/localization/locale-context';

// ─── Locale display names ─────────────────────────────────────────────────────
// Intentionally not translated — locale names are always shown in their own
// language so users can identify them regardless of the current app language.
const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  'en-US': 'English',
  'pt-BR': 'Português',
  'es-ES': 'Español',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LanguageSelectScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { activeLocale, setActiveLocale } = useLocale();

  const [pendingLocale, setPendingLocale] = useState<SupportedLocale>(activeLocale);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = pendingLocale !== activeLocale;

  async function handleSave() {
    if (!isDirty || isSaving) return;
    setIsSaving(true);
    try {
      await setActiveLocale(pendingLocale);
      router.back();
    } catch {
      setIsSaving(false);
      Alert.alert(
        '',
        t('common.error.generic') as string,
        [{ text: 'OK' }]
      );
    }
  }

  function handleBack() {
    router.back();
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.canvas }]}
      testID="settings.languageSelect.screen">

      {/* ── Custom header ────────────────────────────────────────────────── */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + DsSpace.sm,
            borderBottomColor: theme.color.border,
          },
        ]}>
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.headerAction, pressed && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={t('common.back') as string}
          testID="settings.languageSelect.backButton">
          <MaterialIcons name="arrow-back" size={22} color={theme.color.textPrimary} />
        </Pressable>

        <Text style={[styles.headerTitle, { color: theme.color.textPrimary }]}>
          {t('settings.language_select.title')}
        </Text>

        <Pressable
          onPress={isDirty && !isSaving ? handleSave : undefined}
          disabled={!isDirty || isSaving}
          style={({ pressed }) => [styles.headerAction, pressed && isDirty && !isSaving && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={t('settings.language_select.save') as string}
          testID="settings.languageSelect.saveButton">
          <Text
            style={[
              styles.saveLabel,
              {
                color: isDirty && !isSaving ? theme.color.accentPrimary : theme.color.textTertiary,
                fontWeight: isDirty && !isSaving ? '600' : '400',
              },
            ]}>
            {isSaving ? '...' : t('settings.language_select.save')}
          </Text>
        </Pressable>
      </View>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + DsSpace.xl }]}
        testID="settings.languageSelect.scrollView">

        <Text
          style={[styles.sectionHeader, { color: theme.color.textSecondary }]}
          testID="settings.languageSelect.sectionHeader">
          {t('settings.language_select.section_header')}
        </Text>

        <View
          style={[
            styles.group,
            { backgroundColor: theme.color.surface, borderColor: theme.color.border },
          ]}
          testID="settings.languageSelect.optionsGroup">
          {SUPPORTED_LOCALES.map((locale, index) => {
            const isSelected = locale === pendingLocale;
            const isLast = index === SUPPORTED_LOCALES.length - 1;
            return (
              <View key={locale}>
                <Pressable
                  onPress={() => setPendingLocale(locale)}
                  style={({ pressed }) => [
                    styles.localeRow,
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={LOCALE_DISPLAY_NAMES[locale]}
                  testID={`settings.languageSelect.option.${locale}`}>
                  <Text
                    style={[
                      styles.localeName,
                      { color: isSelected ? theme.color.accentPrimary : theme.color.textPrimary },
                    ]}>
                    {LOCALE_DISPLAY_NAMES[locale]}
                  </Text>
                  {isSelected ? (
                    <MaterialIcons
                      name="check"
                      size={20}
                      color={theme.color.accentPrimary}
                      testID={`settings.languageSelect.option.${locale}.checkmark`}
                    />
                  ) : (
                    // Reserve space so row height stays consistent
                    <View style={styles.checkPlaceholder} />
                  )}
                </Pressable>
                {!isLast ? (
                  <View style={[styles.divider, { backgroundColor: theme.color.border }]} />
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: DsSpace.md,
    paddingBottom: DsSpace.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: DsSpace.sm,
  },
  headerAction: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...DsTypography.body,
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 17,
    fontWeight: '600',
  },
  saveLabel: {
    fontSize: 16,
  },

  // Body
  content: {
    paddingHorizontal: DsSpace.lg,
    paddingTop: DsSpace.lg,
    gap: DsSpace.sm,
  },
  sectionHeader: {
    ...DsTypography.caption,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginBottom: 2,
    marginLeft: 4,
    textTransform: 'uppercase',
  },

  // Options group
  group: {
    borderRadius: DsRadius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  localeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.sm,
    minHeight: 52,
  },
  localeName: {
    fontSize: 16,
    flex: 1,
  },
  checkPlaceholder: {
    width: 20,
    height: 20,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
});
