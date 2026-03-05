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
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { lockRole } = useAuthSession();
  const { emitEvent } = useAnalytics();
  const [selectedRole, setSelectedRole] = useState<RoleIntent | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [roleError, setRoleError] = useState<'auth.role.validation.required' | 'auth.role.error.save_failed' | null>(
    null
  );
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
    const role = selectedRole as RoleIntent;
    emitEvent(buildRoleSelected(role));
    if (role === 'student') {
      emitEvent(buildSelfGuidedStartClicked());
    }
    setIsSubmitting(true);
    try {
      await lockRole(role);
      router.replace(resolvePostRoleRoute(role));
    } catch {
      setRoleError('auth.role.error.save_failed');
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
      contentContainerStyle={[styles.container, { backgroundColor: isDark ? '#221410' : '#fff5f0' }]}
      style={{ backgroundColor: isDark ? '#221410' : '#fff5f0' }}
      testID="auth.roleSelection.screen">
      <Stack.Screen options={{ title: t('auth.role.title'), headerShown: false }} />

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
                  outputRange: ['rgba(255,123,114,0)', 'rgba(255,123,114,1)'],
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
                  backgroundColor: isDark ? '#2a1f1b' : '#ffffff',
                },
              ]}
              testID="auth.roleSelection.studentCard">
              {isStudentSelected ? (
                <View style={styles.selectedBadge}>
                  <MaterialIcons color="#ffffff" name="check" size={14} />
                </View>
              ) : null}

              <View style={[styles.cardIcon, { backgroundColor: isDark ? '#3b2f2a' : '#fff1ee' }]}>
                <MaterialIcons color="#ff7b72" name="fitness-center" size={24} />
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
                  outputRange: ['rgba(255,123,114,0)', 'rgba(255,123,114,1)'],
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
                  backgroundColor: isDark ? '#2a1f1b' : '#ffffff',
                },
              ]}
              testID="auth.roleSelection.professionalCard">
              {isProfessionalSelected ? (
                <View style={styles.selectedBadge}>
                  <MaterialIcons color="#ffffff" name="check" size={14} />
                </View>
              ) : null}

              <View style={[styles.cardIcon, { backgroundColor: isDark ? '#3b2f2a' : '#f5f5f5' }]}>
                <MaterialIcons color={palette.icon} name="assignment" size={24} />
              </View>

              <Text style={[styles.roleTitle, { color: palette.text }]}>{t('auth.role.option_pro.title')}</Text>
              <Text style={[styles.roleSubtitle, { color: palette.icon }]}>{t('auth.role.option_pro.subtitle')}</Text>
            </Pressable>
          </Animated.View>
        </View>

        <View style={[styles.lockNotePanel, { backgroundColor: isDark ? '#33261f' : '#fff0e5', borderColor: isDark ? '#4a372e' : '#f8dece' }]}>
          <MaterialIcons color={isDark ? '#fbbf8f' : '#fb923c'} name="info-outline" size={20} style={styles.lockNoteIcon} />
          <Text style={[styles.lockNote, { color: palette.icon }]}>{t('auth.role.lock_note')}</Text>
        </View>

        <View accessibilityLiveRegion="polite">
          {roleError ? (
            <Text style={styles.inlineError} testID="auth.roleSelection.error.roleRequired">
              {t(roleError)}
            </Text>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={() => {
            void onContinue();
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              opacity: isSubmitting ? 0.7 : 1,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            },
          ]}
          testID="auth.roleSelection.continueButton">
          {isSubmitting ? (
            <ActivityIndicator
              accessibilityLabel={t('a11y.loading.submitting')}
              color="#ffffff"
            />
          ) : (
            <>
              <Text style={styles.primaryButtonText}>{t('auth.role.cta_continue')}</Text>
              <MaterialIcons color="#ffffff" name="arrow-forward" size={20} />
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
    backgroundColor: '#ff7b72',
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
    color: '#b3261e',
    fontSize: 13,
    marginTop: 10,
    paddingHorizontal: 6,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#ff7b72',
    borderRadius: 28,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 'auto',
    minHeight: 56,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
});
