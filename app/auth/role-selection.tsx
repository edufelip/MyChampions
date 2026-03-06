import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getDsTheme } from '@/constants/design-system';
import { Colors, Fonts } from '@/constants/theme';
import {
  resolvePostRoleRoute,
  type RoleIntent,
  validateRoleSelectionInput,
} from '@/features/auth/role-selection.logic';
import { useAuthSession } from '@/features/auth/auth-session';
import {
  buildAuthEntryViewed,
  buildRoleSelected,
  buildSelfGuidedStartClicked,
} from '@/features/analytics/analytics.logic';
import { useAnalytics } from '@/features/analytics/use-analytics';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function RoleSelectionScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isHydrated, currentUser, lockRole } = useAuthSession();
  const { emitEvent } = useAnalytics();
  const [selectedRole, setSelectedRole] = useState<RoleIntent | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [roleError, setRoleError] = useState<
    | 'auth.role.validation.required'
    | 'auth.role.error.save_failed'
    | 'auth.role.error.navigation_failed'
    | 'auth.role.error.auth_required'
    | null
  >(null);
  const studentCardSelectionAnim = useRef(new Animated.Value(0)).current;
  const professionalCardSelectionAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    emitEvent(buildAuthEntryViewed('role_selection'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onContinue = async () => {
    const errors = validateRoleSelectionInput({ role: selectedRole });
    if (errors.role) {
      setRoleError(errors.role);
      return;
    }

    setRoleError(null);
    if (!isHydrated || !currentUser) {
      setRoleError('auth.role.error.auth_required');
      router.replace('/auth/sign-in');
      return;
    }

    const role = selectedRole as RoleIntent;
    emitEvent(buildRoleSelected(role));
    if (role === 'student') {
      emitEvent(buildSelfGuidedStartClicked());
    }
    setIsSubmitting(true);
    let didPersistRole = false;
    try {
      await lockRole(role);
      didPersistRole = true;
      router.replace(resolvePostRoleRoute(role) as never);
    } catch (error) {
      if (__DEV__) {
        console.warn('[auth][role-selection] continue failed', {
          phase: didPersistRole ? 'navigation' : 'role_persist',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      setRoleError(didPersistRole ? 'auth.role.error.navigation_failed' : 'auth.role.error.save_failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isStudentSelected = selectedRole === 'student';
  const isProfessionalSelected = selectedRole === 'professional';

  useEffect(() => {
    Animated.timing(studentCardSelectionAnim, {
      toValue: isStudentSelected ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [isStudentSelected, studentCardSelectionAnim]);

  useEffect(() => {
    Animated.timing(professionalCardSelectionAnim, {
      toValue: isProfessionalSelected ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [isProfessionalSelected, professionalCardSelectionAnim]);

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { backgroundColor: theme.color.canvas }]}
      style={{ backgroundColor: theme.color.canvas }}
      testID="auth.roleSelection.screen">
      <Stack.Screen options={{ title: t('auth.role.title'), headerShown: false }} />

      <View
        pointerEvents="none"
        style={[
          styles.blob,
          styles.blobTopLeft,
          { backgroundColor: theme.blob.topLeft },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.blob,
          styles.blobBottomRight,
          { backgroundColor: theme.blob.bottomRight },
        ]}
      />

      <View style={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.titleArea}>
          <Text style={[styles.title, { color: palette.text }]} testID="auth.roleSelection.title">
            {t('auth.role.title')}
          </Text>
          <Text style={[styles.intro, { color: palette.icon }]}>{t('auth.role.intro')}</Text>
        </View>

        <View style={styles.cardGroup}>
          <Animated.View
            style={[
              styles.roleCardOutline,
              {
                borderColor: studentCardSelectionAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['transparent', theme.color.accentPrimary],
                }),
                borderWidth: studentCardSelectionAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [2, 3],
                }),
                transform: [
                  {
                    scale: studentCardSelectionAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.01],
                    }),
                  },
                ],
              },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isStudentSelected }}
              onPress={() => {
                setSelectedRole('student');
                setRoleError(null);
              }}
              style={[
                styles.roleCard,
                {
                  backgroundColor: theme.color.surface,
                },
              ]}
              testID="auth.roleSelection.studentCard">
              {isStudentSelected ? (
                <View style={[styles.selectedBadge, { backgroundColor: theme.color.accentPrimary }]}>
                  <MaterialIcons color={theme.color.onAccent} name="check" size={14} />
                </View>
              ) : null}

              <View style={[styles.cardIcon, { backgroundColor: isDark ? theme.color.successSoft : theme.color.accentPrimarySoft }]}>
                <MaterialIcons color={theme.color.accentPrimary} name="fitness-center" size={24} />
              </View>

              <Text style={[styles.roleTitle, { color: palette.text }]}>{t('auth.role.option_self.title')}</Text>
              <Text style={[styles.roleSubtitle, { color: palette.icon }]}>{t('auth.role.option_self.subtitle')}</Text>
            </Pressable>
          </Animated.View>

          <Animated.View
            style={[
              styles.roleCardOutline,
              {
                borderColor: professionalCardSelectionAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['transparent', theme.color.accentPrimary],
                }),
                borderWidth: professionalCardSelectionAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [2, 3],
                }),
                transform: [
                  {
                    scale: professionalCardSelectionAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.01],
                    }),
                  },
                ],
              },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isProfessionalSelected }}
              onPress={() => {
                setSelectedRole('professional');
                setRoleError(null);
              }}
              style={[
                styles.roleCard,
                {
                  backgroundColor: theme.color.surface,
                },
              ]}
              testID="auth.roleSelection.professionalCard">
              {isProfessionalSelected ? (
                <View style={[styles.selectedBadge, { backgroundColor: theme.color.accentPrimary }]}>
                  <MaterialIcons color={theme.color.onAccent} name="check" size={14} />
                </View>
              ) : null}

              <View style={[styles.cardIcon, { backgroundColor: isDark ? theme.color.successSoft : theme.color.surfaceMuted }]}>
                <MaterialIcons color={palette.icon} name="assignment" size={24} />
              </View>

              <Text style={[styles.roleTitle, { color: palette.text }]}>{t('auth.role.option_pro.title')}</Text>
              <Text style={[styles.roleSubtitle, { color: palette.icon }]}>{t('auth.role.option_pro.subtitle')}</Text>
            </Pressable>
          </Animated.View>
        </View>

        <View style={[styles.lockNotePanel, { backgroundColor: isDark ? theme.color.warningSoft : theme.color.accentPrimarySoft, borderColor: isDark ? theme.color.borderStrong : theme.color.successSoft }]}>
          <MaterialIcons color={theme.color.warning} name="info-outline" size={20} style={styles.lockNoteIcon} />
          <Text style={[styles.lockNote, { color: palette.icon }]}>{t('auth.role.lock_note')}</Text>
        </View>

        <View accessibilityLiveRegion="polite">
          {roleError ? (
            <Text style={[styles.inlineError, { color: theme.color.danger }]} testID="auth.roleSelection.error.roleRequired">
              {t(roleError)}
            </Text>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting || !isHydrated || !currentUser}
          onPress={() => {
            void onContinue();
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: theme.color.accentPrimary,
              opacity: isSubmitting || !isHydrated || !currentUser ? 0.7 : 1,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            },
          ]}
          testID="auth.roleSelection.continueButton">
          {isSubmitting ? (
            <ActivityIndicator
              accessibilityLabel={t('a11y.loading.submitting')}
              color={theme.color.onAccent}
            />
          ) : (
            <>
              <Text style={[styles.primaryButtonText, { color: theme.color.onAccent }]}>{t('auth.role.cta_continue')}</Text>
              <MaterialIcons color={theme.color.onAccent} name="arrow-forward" size={20} />
            </>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
  },
  blob: {
    borderRadius: 999,
    opacity: 0.6,
    position: 'absolute',
  },
  blobTopLeft: {
    height: 300,
    left: -110,
    top: -80,
    width: 300,
  },
  blobBottomRight: {
    bottom: -100,
    height: 340,
    right: -130,
    width: 340,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 0,
  },
  titleArea: {
    marginBottom: 16,
    marginTop: 16,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 40,
    textAlign: 'center',
  },
  intro: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: 'center',
  },
  cardGroup: {
    gap: 12,
    marginTop: 4,
  },
  roleCard: {
    borderRadius: 22,
    elevation: 1,
    gap: 10,
    minHeight: 150,
    paddingHorizontal: 16,
    paddingVertical: 18,
    position: 'relative',
  },
  roleCardOutline: {
    borderRadius: 22,
  },
  selectedBadge: {
    alignItems: 'center',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    top: 12,
    width: 24,
  },
  cardIcon: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  roleTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  roleSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  lockNotePanel: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  lockNoteIcon: {
    marginTop: 1,
  },
  lockNote: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  inlineError: {
    fontSize: 13,
    marginTop: 10,
    paddingHorizontal: 6,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 28,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 'auto',
    minHeight: 56,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },
});
