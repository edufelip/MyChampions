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

  const commitRole = async (role: RoleIntent) => {
    setRoleError(null);
    if (!isHydrated || !currentUser) {
      setRoleError('auth.role.error.auth_required');
      router.replace('/auth/sign-in');
      return;
    }

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

  const onContinue = async () => {
    const errors = validateRoleSelectionInput({ role: selectedRole });
    if (errors.role) {
      setRoleError(errors.role);
      return;
    }
    await commitRole(selectedRole as RoleIntent);
  };

  const isStudentSelected = selectedRole === 'student';
  const isProfessionalSelected = selectedRole === 'professional';

  useEffect(() => {
    Animated.timing(studentCardSelectionAnim, {
      toValue: isStudentSelected ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [isStudentSelected, studentCardSelectionAnim]);

  useEffect(() => {
    Animated.timing(professionalCardSelectionAnim, {
      toValue: isProfessionalSelected ? 1 : 0,
      duration: 200,
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

      {/* Decorative blobs */}
      <View
        pointerEvents="none"
        style={[styles.blob, styles.blobTopLeft, { backgroundColor: theme.blob.topLeft }]}
      />
      <View
        pointerEvents="none"
        style={[styles.blob, styles.blobBottomRight, { backgroundColor: theme.blob.bottomRight }]}
      />

      <View style={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}>
        {/* Hero: brand badge */}
        <View style={styles.heroArea}>
          <View style={[styles.brandBadge, { backgroundColor: theme.color.surface, borderColor: theme.color.accentPrimarySoft }]}>
            <MaterialIcons color={theme.color.accentPrimary} name="fitness-center" size={34} />
          </View>
        </View>

        {/* Title + intro */}
        <View style={styles.titleArea}>
          <Text style={[styles.title, { color: palette.text }]} testID="auth.roleSelection.title">
            {t('auth.role.title')}
          </Text>
          <Text style={[styles.intro, { color: palette.icon }]}>
            {t('auth.role.intro')}
          </Text>
        </View>

        {/* Role cards */}
        <View style={styles.cardGroup}>

          {/* Student card */}
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
                shadowOpacity: studentCardSelectionAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 0.12],
                }),
                transform: [
                  {
                    scale: studentCardSelectionAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.01],
                    }),
                  },
                ],
                shadowColor: theme.color.accentPrimary,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: isStudentSelected ? 4 : 1,
              },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isStudentSelected }}
              accessibilityLabel={`${t('auth.role.option_self.title')}. ${t('auth.role.option_self.description')}`}
              onPress={() => {
                setSelectedRole('student');
                setRoleError(null);
              }}
              style={[styles.roleCard, { backgroundColor: theme.color.surface }]}
              testID="auth.roleSelection.studentCard">

              {isStudentSelected ? (
                <View style={[styles.selectedBadge, { backgroundColor: theme.color.accentPrimary }]}>
                  <MaterialIcons color={theme.color.onAccent} name="check" size={14} />
                </View>
              ) : null}

              <View style={[styles.cardIconWrap, { backgroundColor: isDark ? theme.color.successSoft : theme.color.accentPrimarySoft }]}>
                <MaterialIcons color={theme.color.accentPrimary} name="fitness-center" size={26} />
              </View>

              <View style={styles.cardTextBlock}>
                <Text style={[styles.roleTitle, { color: palette.text }]}>
                  {t('auth.role.option_self.title')}
                </Text>
                <Text style={[styles.roleTag, { color: theme.color.accentPrimary }]}>
                  {t('auth.role.option_self.subtitle')}
                </Text>
                <Text style={[styles.roleDescription, { color: palette.icon }]}>
                  {t('auth.role.option_self.description')}
                </Text>
              </View>
            </Pressable>
          </Animated.View>

          {/* Professional card */}
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
                shadowOpacity: professionalCardSelectionAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 0.12],
                }),
                transform: [
                  {
                    scale: professionalCardSelectionAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.01],
                    }),
                  },
                ],
                shadowColor: theme.color.accentPrimary,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: isProfessionalSelected ? 4 : 1,
              },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isProfessionalSelected }}
              accessibilityLabel={`${t('auth.role.option_pro.title')}. ${t('auth.role.option_pro.description')}`}
              onPress={() => {
                setSelectedRole('professional');
                setRoleError(null);
              }}
              style={[styles.roleCard, { backgroundColor: theme.color.surface }]}
              testID="auth.roleSelection.professionalCard">

              {isProfessionalSelected ? (
                <View style={[styles.selectedBadge, { backgroundColor: theme.color.accentPrimary }]}>
                  <MaterialIcons color={theme.color.onAccent} name="check" size={14} />
                </View>
              ) : null}

              <View style={[styles.cardIconWrap, { backgroundColor: isDark ? theme.color.accentPrimarySoft : theme.color.accentPrimarySoft }]}>
                <MaterialIcons color={isDark ? theme.color.accentPrimary : theme.color.accentPrimary} name="assignment" size={26} />
              </View>

              <View style={styles.cardTextBlock}>
                <Text style={[styles.roleTitle, { color: palette.text }]}>
                  {t('auth.role.option_pro.title')}
                </Text>
                <Text style={[styles.roleTag, { color: theme.color.accentPrimary }]}>
                  {t('auth.role.option_pro.subtitle')}
                </Text>
                <Text style={[styles.roleDescription, { color: palette.icon }]}>
                  {t('auth.role.option_pro.description')}
                </Text>
              </View>
            </Pressable>
          </Animated.View>

        </View>

        {/* Lock note */}
        <View style={[
          styles.lockNotePanel,
          {
            backgroundColor: isDark ? theme.color.warningSoft : theme.color.accentPrimarySoft,
            borderColor: isDark ? theme.color.borderStrong : theme.color.successSoft,
          },
        ]}>
          <MaterialIcons color={theme.color.warning} name="lock-outline" size={18} style={styles.lockNoteIcon} />
          <Text style={[styles.lockNote, { color: palette.icon }]}>
            {t('auth.role.lock_note')}
          </Text>
        </View>

        {/* Validation / error */}
        <View accessibilityLiveRegion="polite">
          {roleError ? (
            <Text
              style={[styles.inlineError, { color: theme.color.danger }]}
              testID="auth.roleSelection.error.roleRequired">
              {t(roleError)}
            </Text>
          ) : null}
        </View>

        {/* Primary CTA */}
        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting || !isHydrated || !currentUser}
          onPress={() => { void onContinue(); }}
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
              <Text style={[styles.primaryButtonText, { color: theme.color.onAccent }]}>
                {t('auth.role.cta_continue')}
              </Text>
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
    height: 280,
    left: -100,
    top: -70,
    width: 280,
  },
  blobBottomRight: {
    bottom: -90,
    height: 320,
    right: -120,
    width: 320,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  heroArea: {
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  brandBadge: {
    alignItems: 'center',
    borderRadius: 50,
    borderWidth: 4,
    elevation: 2,
    height: 88,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    width: 88,
  },
  titleArea: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 36,
    textAlign: 'center',
  },
  intro: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  cardGroup: {
    gap: 12,
    marginBottom: 16,
  },
  roleCardOutline: {
    borderRadius: 22,
  },
  roleCard: {
    borderRadius: 22,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
    minHeight: 110,
    paddingHorizontal: 18,
    paddingVertical: 18,
    position: 'relative',
  },
  selectedBadge: {
    alignItems: 'center',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: 14,
    top: 14,
    width: 24,
  },
  cardIconWrap: {
    alignItems: 'center',
    borderRadius: 24,
    height: 52,
    justifyContent: 'center',
    marginTop: 2,
    width: 52,
    flexShrink: 0,
  },
  cardTextBlock: {
    flex: 1,
    gap: 3,
    paddingRight: 28, // space for selected badge
  },
  roleTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  roleTag: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    lineHeight: 18,
  },
  roleDescription: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
  },
  lockNotePanel: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lockNoteIcon: {
    marginTop: 1,
    flexShrink: 0,
  },
  lockNote: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  inlineError: {
    fontSize: 13,
    marginBottom: 10,
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
    // Lift the button
    shadowColor: '#1ea95a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 4,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },
});
