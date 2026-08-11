import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
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
import { requestPasswordResetFromSource } from '@/features/auth/account-auth-source';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function ForgotPasswordScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const palette = Colors[colorScheme];
  const router = useRouter();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const emailRef = useRef('');
  const [emailError, setEmailError] = useState<'auth.validation.email_required' | null>(null);
  const [submitError, setSubmitError] = useState<'auth.forgot_password.error.generic' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const onEmailChange = (value: string) => {
    emailRef.current = value;
    setEmail(value);
  };

  const onSubmit = async () => {
    const trimmedEmail = emailRef.current.trim();
    setSubmitError(null);

    if (trimmedEmail.length === 0) {
      setEmailError('auth.validation.email_required');
      return;
    }
    setEmailError(null);

    setSubmitting(true);
    try {
      await requestPasswordResetFromSource(trimmedEmail);
      setSubmittedEmail(trimmedEmail);
    } catch {
      setSubmitError('auth.forgot_password.error.generic');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      testID="auth.forgotPassword.screen"
    >
      <Stack.Screen options={{ title: t('auth.forgot_password.title'), headerShown: false }} />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="auth.forgotPassword.scrollView"
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
            testID="auth.forgotPassword.backButton"
          >
            <MaterialIcons color={palette.text} name="arrow-back" size={22} />
          </Pressable>
        </View>

        <View style={styles.titleArea}>
          <Text style={[styles.title, { color: palette.text }]} testID="auth.forgotPassword.title">
            {t('auth.forgot_password.title')}
          </Text>
          <Text style={[styles.subtitle, { color: palette.icon }]}>
            {t('auth.forgot_password.subtitle')}
          </Text>
        </View>

        {submittedEmail ? (
          <View
            style={[
              styles.inlineBanner,
              { backgroundColor: theme.color.successSoft, borderColor: theme.color.success },
            ]}
            testID="auth.forgotPassword.successBanner"
            accessibilityRole="alert"
          >
            <Text style={[styles.inlineBannerTitle, { color: theme.color.success }]}>
              {t('auth.forgot_password.success.title')}
            </Text>
            <Text style={[styles.inlineBannerBody, { color: theme.color.textPrimary }]}>
              {t('auth.forgot_password.success.body', { email: submittedEmail })}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSubmittedEmail(null)}
              testID="auth.forgotPassword.retryButton"
              style={styles.retryButton}
            >
              <Text style={[styles.retryButtonText, { color: theme.color.accentPrimary }]}>
                {t('auth.forgot_password.success.retry')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.formWrapper}>
            <View style={styles.formSection}>
              <Text style={[styles.fieldLabel, { color: palette.text }]}>
                {t('auth.field.email')}
              </Text>
              <TextInput
                accessibilityLabel={t('auth.field.email')}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={onEmailChange}
                onSubmitEditing={() => {
                  void onSubmit();
                }}
                placeholder={t('auth.placeholder.email')}
                placeholderTextColor={palette.icon}
                returnKeyType="done"
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.color.surface,
                    borderColor: 'transparent',
                    color: palette.text,
                  },
                ]}
                testID="auth.forgotPassword.emailInput"
                value={email}
              />
              <View accessibilityLiveRegion="polite">
                {emailError ? (
                  <Text
                    style={[styles.inlineError, { color: theme.color.danger }]}
                    testID="auth.forgotPassword.error.emailRequired"
                  >
                    {t(emailError)}
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
              testID="auth.forgotPassword.submitButton"
            >
              {submitting ? (
                <ActivityIndicator
                  accessibilityLabel={t('a11y.loading.submitting')}
                  color={theme.color.onAccent}
                />
              ) : (
                <Text style={[styles.primaryButtonText, { color: theme.color.onAccent }]}>
                  {t('auth.forgot_password.cta_primary')}
                </Text>
              )}
            </Pressable>

            <View accessibilityRole="alert">
              {submitError ? (
                <Text
                  style={[styles.submitError, { color: theme.color.danger }]}
                  testID="auth.forgotPassword.error.submit"
                >
                  {t(submitError)}
                </Text>
              ) : null}
            </View>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/auth/sign-in')}
          testID="auth.forgotPassword.backToSignInButton"
          style={styles.secondaryButton}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.tint }]}>
            {t('auth.forgot_password.cta_back_signin')}
          </Text>
        </Pressable>
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
    gap: 14,
  },
  formSection: {
    gap: 10,
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
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  inlineError: {
    fontSize: 13,
    paddingHorizontal: 12,
  },
  submitError: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    marginTop: 2,
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
  secondaryButton: {
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 'auto',
    paddingBottom: 16,
    paddingTop: 24,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
