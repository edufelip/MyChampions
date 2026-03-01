import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
  const router = useRouter();
  const { t } = useTranslation();
  const { lockRole } = useAuthSession();
  const { emitEvent } = useAnalytics();
  const [selectedRole, setSelectedRole] = useState<RoleIntent | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [roleError, setRoleError] = useState<'auth.role.validation.required' | 'auth.role.error.save_failed' | null>(
    null
  );

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

  const onQuickSelfGuided = async () => {
    setRoleError(null);
    emitEvent(buildSelfGuidedStartClicked());
    setIsSubmitting(true);
    try {
      setSelectedRole('student');
      await lockRole('student');
      router.replace(resolvePostRoleRoute('student'));
    } catch {
      setRoleError('auth.role.error.save_failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isStudentSelected = selectedRole === 'student';
  const isProfessionalSelected = selectedRole === 'professional';

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { backgroundColor: palette.background }]}
      style={{ backgroundColor: palette.background }}
      testID="auth.roleSelection.screen">
      <Stack.Screen options={{ title: t('auth.role.title'), headerShown: false }} />

      <Text style={[styles.title, { color: palette.text }]} testID="auth.roleSelection.title">
        {t('auth.role.title')}
      </Text>
      <Text style={[styles.intro, { color: palette.icon }]}>{t('auth.role.intro')}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: isStudentSelected }}
        onPress={() => {
          setSelectedRole('student');
          setRoleError(null);
        }}
        style={[
          styles.roleCard,
          { borderColor: isStudentSelected ? palette.tint : palette.icon },
        ]}
        testID="auth.roleSelection.studentCard">
        <Text style={[styles.roleTitle, { color: palette.text }]}>{t('auth.role.option_self.title')}</Text>
        <Text style={[styles.roleSubtitle, { color: palette.icon }]}>
          {t('auth.role.option_self.subtitle')}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: isProfessionalSelected }}
        onPress={() => {
          setSelectedRole('professional');
          setRoleError(null);
        }}
        style={[
          styles.roleCard,
          { borderColor: isProfessionalSelected ? palette.tint : palette.icon },
        ]}
        testID="auth.roleSelection.professionalCard">
        <Text style={[styles.roleTitle, { color: palette.text }]}>{t('auth.role.option_pro.title')}</Text>
        <Text style={[styles.roleSubtitle, { color: palette.icon }]}>
          {t('auth.role.option_pro.subtitle')}
        </Text>
      </Pressable>

      <Text style={[styles.lockNote, { color: palette.icon }]}>{t('auth.role.lock_note')}</Text>

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
        style={[styles.primaryButton, { backgroundColor: palette.tint }]}
        testID="auth.roleSelection.continueButton">
        <Text style={styles.primaryButtonText}>{t('auth.role.cta_continue')}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting}
        onPress={() => {
          void onQuickSelfGuided();
        }}
        style={styles.secondaryButton}
        testID="auth.roleSelection.quickSelfGuidedButton">
        <Text style={[styles.secondaryButtonText, { color: palette.tint }]}>
          {t('auth.role.cta_start_self_guided')}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace('/auth/sign-in')}
        style={styles.backButton}
        testID="auth.roleSelection.backButton">
        <Text style={[styles.buttonText, { color: palette.tint }]}>
          {t('auth.role.cta_back')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 80,
    paddingBottom: 40,
    gap: 16,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
  },
  intro: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },
  roleCard: {
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 6,
    padding: 14,
  },
  roleTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  roleSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  lockNote: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  inlineError: {
    color: '#b3261e',
    fontSize: 13,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  backButton: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
