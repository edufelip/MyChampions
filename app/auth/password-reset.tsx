import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getDsTheme } from '@/constants/design-system';
import { Colors, Fonts } from '@/constants/theme';
import { confirmPasswordResetFromSource } from '@/features/auth/account-auth-source';
import {
  mapResetPasswordReasonToMessageKey,
  normalizeResetPasswordReason,
  validateResetPasswordInput,
  type ResetPasswordErrorMessageKey,
  type ResetPasswordValidationErrors,
} from '@/features/auth/reset-password.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function ResetPasswordScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const palette = Colors[colorScheme];
  const router = useRouter();
  const { t } = useTranslation();
  const searchParams = useLocalSearchParams<{
    token?: string | string[];
    email?: string | string[];
  }>();

  const [email, setEmail] = useState(() => firstParam(searchParams.email));
  const [token, setToken] = useState(() => firstParam(searchParams.token));
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
  const newPasswordConfirmationRef = useRef('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showNewPasswordConfirmation, setShowNewPasswordConfirmation] = useState(false);
  const [errors, setErrors] = useState<ResetPasswordValidationErrors>({});
  const [submitError, setSubmitError] = useState<ResetPasswordErrorMessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);

  const onNewPasswordConfirmationChange = (value: string) => {
    newPasswordConfirmationRef.current = value;
    setNewPasswordConfirmation(value);
  };

  const onSubmit = async (submittedConfirmation?: string) => {
    const submissionInput = {
      email,
      token,
      newPassword,
      newPasswordConfirmation: submittedConfirmation ?? newPasswordConfirmationRef.current,
    };
    const nextErrors = validateResetPasswordInput(submissionInput);
    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      await confirmPasswordResetFromSource(submissionInput);
      setResetComplete(true);
    } catch (error: unknown) {
      const reason = normalizeResetPasswordReason(error);
      setSubmitError(mapResetPasswordReasonToMessageKey(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      testID="auth.resetPassword.screen"
    >
      <Stack.Screen options={{ title: t('auth.reset_password.title'), headerShown: false }} />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="auth.resetPassword.scrollView"
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.replace('/auth/sign-in');
            }}
            style={[styles.backButton, { backgroundColor: theme.color.surface }]}
            testID="auth.resetPassword.backButton"
          >
            <MaterialIcons color={palette.text} name="arrow-back" size={22} />
          </Pressable>
        </View>

        <View style={styles.titleArea}>
          <Text style={[styles.title, { color: palette.text }]} testID="auth.resetPassword.title">
            {t('auth.reset_password.title')}
          </Text>
          <Text style={[styles.subtitle, { color: palette.icon }]}>
            {t('auth.reset_password.subtitle')}
          </Text>
        </View>

        {resetComplete ? (
          <View
            style={[
              styles.inlineBanner,
              { backgroundColor: theme.color.successSoft, borderColor: theme.color.success },
            ]}
            testID="auth.resetPassword.successBanner"
            accessibilityRole="alert"
          >
            <Text style={[styles.inlineBannerTitle, { color: theme.color.success }]}>
              {t('auth.reset_password.success.title')}
            </Text>
            <Text style={[styles.inlineBannerBody, { color: theme.color.textPrimary }]}>
              {t('auth.reset_password.success.body')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/auth/sign-in')}
              testID="auth.resetPassword.goSignInButton"
              style={styles.retryButton}
            >
              <Text style={[styles.retryButtonText, { color: theme.color.accentPrimary }]}>
                {t('auth.reset_password.cta_go_signin')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.formWrapper}>
            <View style={styles.formSection}>
              <Text style={[styles.fieldLabel, { color: palette.text }]}>
                {t('auth.reset_password.field.email')}
              </Text>
              <TextInput
                accessibilityLabel={t('auth.reset_password.field.email')}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder={t('auth.placeholder.email')}
                placeholderTextColor={palette.icon}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.color.surface,
                    borderColor: 'transparent',
                    color: palette.text,
                  },
                ]}
                testID="auth.resetPassword.emailInput"
                value={email}
              />
              <View accessibilityLiveRegion="polite">
                {errors.email ? (
                  <Text
                    style={[styles.inlineError, { color: theme.color.danger }]}
                    testID="auth.resetPassword.error.email"
                  >
                    {t(errors.email)}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.formSection}>
              <Text style={[styles.fieldLabel, { color: palette.text }]}>
                {t('auth.reset_password.field.token')}
              </Text>
              <TextInput
                accessibilityLabel={t('auth.reset_password.field.token')}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                onChangeText={setToken}
                placeholder={t('auth.reset_password.placeholder.token')}
                placeholderTextColor={palette.icon}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.color.surface,
                    borderColor: 'transparent',
                    color: palette.text,
                  },
                ]}
                testID="auth.resetPassword.tokenInput"
                value={token}
              />
              <View accessibilityLiveRegion="polite">
                {errors.token ? (
                  <Text
                    style={[styles.inlineError, { color: theme.color.danger }]}
                    testID="auth.resetPassword.error.token"
                  >
                    {t(errors.token)}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.formSection}>
              <Text style={[styles.fieldLabel, { color: palette.text }]}>
                {t('auth.reset_password.field.new_password')}
              </Text>
              <View style={styles.passwordRow}>
                <TextInput
                  accessibilityLabel={t('auth.reset_password.field.new_password')}
                  autoCapitalize="none"
                  autoComplete="password-new"
                  onChangeText={setNewPassword}
                  placeholder={t('auth.reset_password.placeholder.new_password')}
                  placeholderTextColor={palette.icon}
                  secureTextEntry={!showNewPassword}
                  style={[
                    styles.input,
                    styles.passwordInput,
                    {
                      backgroundColor: theme.color.surface,
                      borderColor: 'transparent',
                      color: palette.text,
                    },
                  ]}
                  testID="auth.resetPassword.newPasswordInput"
                  value={newPassword}
                />
                <Pressable
                  accessibilityLabel={
                    showNewPassword
                      ? t('auth.password.toggle_hide')
                      : t('auth.password.toggle_show')
                  }
                  accessibilityRole="button"
                  onPress={() => setShowNewPassword((current) => !current)}
                  testID="auth.resetPassword.newPasswordToggle"
                  style={[styles.passwordToggle, { backgroundColor: theme.color.surfaceMuted }]}
                >
                  <Text style={[styles.passwordToggleText, { color: palette.text }]}>
                    {showNewPassword
                      ? t('auth.password.toggle_hide_short')
                      : t('auth.password.toggle_show_short')}
                  </Text>
                </Pressable>
              </View>
              <View accessibilityLiveRegion="polite">
                {errors.newPassword ? (
                  <Text
                    style={[styles.inlineError, { color: theme.color.danger }]}
                    testID="auth.resetPassword.error.newPassword"
                  >
                    {t(errors.newPassword)}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.formSection}>
              <Text style={[styles.fieldLabel, { color: palette.text }]}>
                {t('auth.reset_password.field.new_password_confirmation')}
              </Text>
              <View style={styles.passwordRow}>
                <TextInput
                  accessibilityLabel={t('auth.reset_password.field.new_password_confirmation')}
                  autoCapitalize="none"
                  autoComplete="password-new"
                  blurOnSubmit
                  onChangeText={onNewPasswordConfirmationChange}
                  onSubmitEditing={({ nativeEvent }) => {
                    void onSubmit(nativeEvent.text);
                  }}
                  placeholder={t('auth.reset_password.placeholder.new_password_confirmation')}
                  placeholderTextColor={palette.icon}
                  returnKeyType="done"
                  secureTextEntry={!showNewPasswordConfirmation}
                  style={[
                    styles.input,
                    styles.passwordInput,
                    {
                      backgroundColor: theme.color.surface,
                      borderColor: 'transparent',
                      color: palette.text,
                    },
                  ]}
                  testID="auth.resetPassword.newPasswordConfirmationInput"
                  value={newPasswordConfirmation}
                />
                <Pressable
                  accessibilityLabel={
                    showNewPasswordConfirmation
                      ? t('auth.password.toggle_hide')
                      : t('auth.password.toggle_show')
                  }
                  accessibilityRole="button"
                  onPress={() => setShowNewPasswordConfirmation((current) => !current)}
                  testID="auth.resetPassword.newPasswordConfirmationToggle"
                  style={[styles.passwordToggle, { backgroundColor: theme.color.surfaceMuted }]}
                >
                  <Text style={[styles.passwordToggleText, { color: palette.text }]}>
                    {showNewPasswordConfirmation
                      ? t('auth.password.toggle_hide_short')
                      : t('auth.password.toggle_show_short')}
                  </Text>
                </Pressable>
              </View>
              <View accessibilityLiveRegion="polite">
                {errors.newPasswordConfirmation ? (
                  <Text
                    style={[styles.inlineError, { color: theme.color.danger }]}
                    testID="auth.resetPassword.error.newPasswordConfirmation"
                  >
                    {t(errors.newPasswordConfirmation)}
                  </Text>
                ) : null}
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => {
                void onSubmit();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: theme.color.accentPrimary,
                  opacity: submitting ? 0.7 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
              testID="auth.resetPassword.submitButton"
            >
              {submitting ? (
                <ActivityIndicator
                  accessibilityLabel={t('a11y.loading.submitting')}
                  color={theme.color.onAccent}
                />
              ) : (
                <Text style={[styles.primaryButtonText, { color: theme.color.onAccent }]}>
                  {t('auth.reset_password.cta_primary')}
                </Text>
              )}
            </Pressable>

            <View accessibilityRole="alert">
              {submitError ? (
                <Text
                  style={[styles.submitError, { color: theme.color.danger }]}
                  testID="auth.resetPassword.error.submit"
                >
                  {t(submitError)}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 48,
    paddingTop: 20,
  },
  header: {
    flexDirection: 'row',
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 24,
    elevation: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  titleArea: {
    marginBottom: 24,
    marginTop: 24,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 15,
    marginTop: 8,
  },
  formWrapper: {
    gap: 12,
  },
  formSection: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 12,
  },
  input: {
    borderRadius: 28,
    borderWidth: 2,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  passwordRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  passwordInput: {
    flex: 1,
    paddingRight: 12,
  },
  passwordToggle: {
    alignItems: 'center',
    borderRadius: 20,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 68,
    paddingHorizontal: 14,
  },
  passwordToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  inlineError: {
    fontSize: 13,
    paddingHorizontal: 12,
  },
  submitError: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 28,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 56,
    marginTop: 2,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  inlineBanner: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  inlineBannerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  inlineBannerBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
