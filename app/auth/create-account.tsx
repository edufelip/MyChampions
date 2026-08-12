import { AntDesign, Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDsTheme } from '@/constants/design-system';
import { Colors, Fonts } from '@/constants/theme';
import {
  buildAuthEntryViewed,
  buildSignUpFailed,
  buildSignUpSubmitted,
} from '@/features/analytics/analytics.logic';
import { useAnalytics } from '@/features/analytics/use-analytics';
import { signInWithAppleProviderTokenFromSource } from '@/features/auth/apple-social-auth-source';
import { normalizeAuthReturnTo } from '@/features/auth/auth-route-guard.logic';
import { useAuthSession } from '@/features/auth/auth-session';
import {
  CreateAccountFailure,
  mapCreateAccountReasonToMessageKey,
  normalizeCreateAccountReason,
  resolveCreateAccountValidationAnalyticsReason,
  type CreateAccountErrorMessageKey,
  validateCreateAccountInput,
  type CreateAccountValidationErrors,
} from '@/features/auth/create-account.logic';
import { createAccountWithEmailPasswordFromSource } from '@/features/auth/email-auth-source';
import { signInWithGoogleProviderTokenFromSource } from '@/features/auth/google-social-auth-source';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function CreateAccountScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const palette = Colors[colorScheme];
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = normalizeAuthReturnTo(searchParams.returnTo);
  const { t } = useTranslation();
  const { emitEvent } = useAnalytics();
  const {
    createAccountWithE2EEmailPassword,
    signInWithE2ESocialAuth,
    signInWithServerSocialAuth,
    adoptCurrentServerSession,
  } = useAuthSession();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const usesCompactMobileLayout = viewportWidth < 480 && viewportHeight <= 900;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const passwordConfirmationRef = useRef('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [errors, setErrors] = useState<CreateAccountValidationErrors>({});
  const [submitError, setSubmitError] = useState<CreateAccountErrorMessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState<
    'name' | 'email' | 'password' | 'passwordConfirmation' | null
  >(null);

  const buildAuthRoute = (pathname: '/auth/sign-in') => {
    if (!returnTo) {
      return pathname;
    }

    return { pathname, params: { returnTo } };
  };

  useEffect(() => {
    emitEvent(buildAuthEntryViewed('auth_create_account'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPasswordConfirmationChange = (value: string) => {
    passwordConfirmationRef.current = value;
    setPasswordConfirmation(value);
  };

  const onCreateAccount = async (submittedPasswordConfirmation?: string) => {
    const submissionInput = {
      name,
      email,
      password,
      passwordConfirmation: submittedPasswordConfirmation ?? passwordConfirmationRef.current,
    };
    const nextErrors = validateCreateAccountInput(submissionInput);
    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0) {
      const validationReason = resolveCreateAccountValidationAnalyticsReason(nextErrors);
      if (validationReason) {
        emitEvent(buildSignUpFailed('email_password', validationReason));
      }
      return;
    }

    emitEvent(buildSignUpSubmitted('email_password'));
    setSubmitting(true);
    try {
      if (await createAccountWithE2EEmailPassword(submissionInput)) {
        return;
      }
      await createAccountWithEmailPasswordFromSource(submissionInput);
      if (!adoptCurrentServerSession()) throw new CreateAccountFailure('unknown');
    } catch (error: unknown) {
      const reason = normalizeCreateAccountReason(error);
      emitEvent(buildSignUpFailed('email_password', reason));
      setSubmitError(mapCreateAccountReasonToMessageKey(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleCreateAccount = async () => {
    setSubmitError(null);
    emitEvent(buildSignUpSubmitted('google'));

    try {
      if (await signInWithE2ESocialAuth('google')) {
        return;
      }
      try {
        await signInWithGoogleProviderTokenFromSource();
        if (!adoptCurrentServerSession()) throw new CreateAccountFailure('unknown');
        return;
      } catch (error: unknown) {
        if (normalizeCreateAccountReason(error) !== 'configuration') {
          throw error;
        }
      }
      if (await signInWithServerSocialAuth('google')) {
        return;
      }

      throw new CreateAccountFailure('configuration');
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code.includes('ERR_REQUEST_CANCELED')) {
        return;
      }

      const reason = normalizeCreateAccountReason(error);
      emitEvent(buildSignUpFailed('google', reason));
      setSubmitError(mapCreateAccountReasonToMessageKey(reason));
    }
  };

  const onAppleCreateAccount = async () => {
    setSubmitError(null);
    emitEvent(buildSignUpSubmitted('apple'));

    try {
      if (await signInWithE2ESocialAuth('apple')) {
        return;
      }
      try {
        await signInWithAppleProviderTokenFromSource();
        if (!adoptCurrentServerSession()) throw new CreateAccountFailure('unknown');
        return;
      } catch (error: unknown) {
        if (normalizeCreateAccountReason(error) !== 'configuration') {
          throw error;
        }
      }
      if (await signInWithServerSocialAuth('apple')) {
        return;
      }

      throw new CreateAccountFailure('configuration');
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code.includes('ERR_REQUEST_CANCELED')) {
        return;
      }

      const reason = normalizeCreateAccountReason(error);
      emitEvent(buildSignUpFailed('apple', reason));
      setSubmitError(mapCreateAccountReasonToMessageKey(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      testID="auth.createAccount.screen"
    >
      <Stack.Screen options={{ title: t('auth.signup.title'), headerShown: false }} />

      <ScrollView
        style={styles.content}
        contentContainerStyle={[
          styles.contentContainer,
          usesCompactMobileLayout && styles.contentContainerCompact,
          {
            paddingTop: insets.top + (usesCompactMobileLayout ? 8 : 14),
            paddingBottom: insets.bottom + (usesCompactMobileLayout ? 20 : 48),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="auth.createAccount.scrollView"
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={t('auth.role.cta_back')}
            accessibilityRole="button"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }

              router.replace(buildAuthRoute('/auth/sign-in') as never);
            }}
            style={[
              styles.backButton,
              { backgroundColor: theme.color.surface, borderColor: theme.color.textTertiary },
            ]}
            testID="auth.createAccount.backButton"
          >
            <MaterialIcons color={palette.text} name="arrow-back" size={22} />
          </Pressable>
          <View
            style={[styles.headerBrandMark, { backgroundColor: theme.color.accentPrimarySoft }]}
          >
            <Image
              accessibilityLabel={t('a11y.brand_logo')}
              contentFit="contain"
              source={require('../../assets/images/logo.svg')}
              style={styles.headerBrandLogo}
            />
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <View style={[styles.titleArea, usesCompactMobileLayout && styles.titleAreaCompact]}>
          <Text
            style={[
              styles.title,
              usesCompactMobileLayout && styles.titleCompact,
              { color: palette.text },
            ]}
            testID="auth.createAccount.title"
          >
            {t('auth.signup.title')}
          </Text>
          <Text style={[styles.subtitle, { color: palette.icon }]}>
            {t('auth.signup.subtitle')}
          </Text>
        </View>

        <View style={[styles.formWrapper, usesCompactMobileLayout && styles.formWrapperCompact]}>
          <View style={styles.formSection}>
            <Text style={[styles.fieldLabel, { color: palette.text }]}>{t('auth.field.name')}</Text>
            <TextInput
              accessibilityLabel={t('auth.field.name')}
              autoCapitalize="words"
              autoComplete="name"
              onBlur={() => setFocusedField(null)}
              onChangeText={setName}
              onFocus={() => setFocusedField('name')}
              placeholder={t('auth.placeholder.name')}
              placeholderTextColor={palette.icon}
              style={[
                styles.input,
                {
                  backgroundColor: theme.color.surface,
                  borderColor: errors.name
                    ? theme.color.danger
                    : focusedField === 'name'
                      ? theme.color.accentPrimary
                      : theme.color.textTertiary,
                  color: palette.text,
                },
              ]}
              testID="auth.createAccount.nameInput"
              value={name}
            />
            <View accessibilityLiveRegion="polite">
              {errors.name ? (
                <Text
                  style={[styles.inlineError, { color: theme.color.danger }]}
                  testID="auth.createAccount.error.nameRequired"
                >
                  {t(errors.name)}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.formSection}>
            <Text style={[styles.fieldLabel, { color: palette.text }]}>
              {t('auth.field.email')}
            </Text>
            <TextInput
              accessibilityLabel={t('auth.field.email')}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onBlur={() => setFocusedField(null)}
              onChangeText={setEmail}
              onFocus={() => setFocusedField('email')}
              placeholder={t('auth.placeholder.email')}
              placeholderTextColor={palette.icon}
              style={[
                styles.input,
                {
                  backgroundColor: theme.color.surface,
                  borderColor: errors.email
                    ? theme.color.danger
                    : focusedField === 'email'
                      ? theme.color.accentPrimary
                      : theme.color.textTertiary,
                  color: palette.text,
                },
              ]}
              testID="auth.createAccount.emailInput"
              value={email}
            />
            <View accessibilityLiveRegion="polite">
              {errors.email ? (
                <Text
                  style={[styles.inlineError, { color: theme.color.danger }]}
                  testID="auth.createAccount.error.emailRequired"
                >
                  {t(errors.email)}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.formSection}>
            <Text style={[styles.fieldLabel, { color: palette.text }]}>
              {t('auth.field.password')}
            </Text>
            <View style={styles.passwordRow}>
              <TextInput
                accessibilityLabel={t('auth.field.password')}
                autoCapitalize="none"
                autoComplete="password-new"
                onBlur={() => setFocusedField(null)}
                onChangeText={setPassword}
                onFocus={() => setFocusedField('password')}
                placeholder={t('auth.placeholder.password')}
                placeholderTextColor={palette.icon}
                secureTextEntry={!showPassword}
                style={[
                  styles.input,
                  styles.passwordInput,
                  {
                    backgroundColor: theme.color.surface,
                    borderColor: errors.password
                      ? theme.color.danger
                      : focusedField === 'password'
                        ? theme.color.accentPrimary
                        : theme.color.textTertiary,
                    color: palette.text,
                  },
                ]}
                testID="auth.createAccount.passwordInput"
                value={password}
              />
              <Pressable
                accessibilityLabel={
                  showPassword ? t('auth.password.toggle_hide') : t('auth.password.toggle_show')
                }
                accessibilityRole="button"
                onPress={() => setShowPassword((current) => !current)}
                testID="auth.createAccount.passwordToggle"
                style={[
                  styles.passwordToggle,
                  {
                    backgroundColor: theme.color.surfaceMuted,
                    borderColor: theme.color.textTertiary,
                  },
                ]}
              >
                <MaterialIcons
                  color={palette.text}
                  name={showPassword ? 'visibility-off' : 'visibility'}
                  size={20}
                />
              </Pressable>
            </View>
            <Text style={[styles.helperText, { color: palette.icon }]}>
              {t('auth.signup.password_helper')}
            </Text>
            <View accessibilityLiveRegion="polite">
              {errors.password ? (
                <Text
                  style={[styles.inlineError, { color: theme.color.danger }]}
                  testID="auth.createAccount.error.password"
                >
                  {t(errors.password)}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.formSection}>
            <Text style={[styles.fieldLabel, { color: palette.text }]}>
              {t('auth.field.password_confirmation')}
            </Text>
            <View style={styles.passwordRow}>
              <TextInput
                accessibilityLabel={t('auth.field.password_confirmation')}
                autoCapitalize="none"
                autoComplete="password-new"
                blurOnSubmit
                onBlur={() => setFocusedField(null)}
                onChangeText={onPasswordConfirmationChange}
                onFocus={() => setFocusedField('passwordConfirmation')}
                onSubmitEditing={({ nativeEvent }) => {
                  void onCreateAccount(nativeEvent.text);
                }}
                placeholder={t('auth.placeholder.password_confirmation')}
                placeholderTextColor={palette.icon}
                returnKeyType="done"
                secureTextEntry={!showPasswordConfirmation}
                style={[
                  styles.input,
                  styles.passwordInput,
                  {
                    backgroundColor: theme.color.surface,
                    borderColor: errors.passwordConfirmation
                      ? theme.color.danger
                      : focusedField === 'passwordConfirmation'
                        ? theme.color.accentPrimary
                        : theme.color.textTertiary,
                    color: palette.text,
                  },
                ]}
                testID="auth.createAccount.passwordConfirmationInput"
                value={passwordConfirmation}
              />
              <Pressable
                accessibilityLabel={
                  showPasswordConfirmation
                    ? t('auth.password.toggle_hide')
                    : t('auth.password.toggle_show')
                }
                accessibilityRole="button"
                onPress={() => setShowPasswordConfirmation((current) => !current)}
                testID="auth.createAccount.passwordConfirmationToggle"
                style={[
                  styles.passwordToggle,
                  {
                    backgroundColor: theme.color.surfaceMuted,
                    borderColor: theme.color.textTertiary,
                  },
                ]}
              >
                <MaterialIcons
                  color={palette.text}
                  name={showPasswordConfirmation ? 'visibility-off' : 'visibility'}
                  size={20}
                />
              </Pressable>
            </View>
            <View accessibilityLiveRegion="polite">
              {errors.passwordConfirmation ? (
                <Text
                  style={[styles.inlineError, { color: theme.color.danger }]}
                  testID="auth.createAccount.error.passwordConfirmation"
                >
                  {t(errors.passwordConfirmation)}
                </Text>
              ) : null}
            </View>
          </View>

          <View accessibilityRole="alert">
            {submitError ? (
              <Text
                style={[styles.submitError, { color: theme.color.danger }]}
                testID="auth.createAccount.error.submit"
              >
                {t(submitError)}
              </Text>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => {
              void onCreateAccount();
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: submitting
                  ? theme.color.disabledSurface
                  : theme.color.accentPrimary,
                transform: [{ scale: pressed ? 0.99 : 1 }],
              },
            ]}
            testID="auth.createAccount.submitButton"
          >
            {submitting ? (
              <ActivityIndicator
                accessibilityLabel={t('a11y.loading.submitting')}
                color={submitting ? theme.color.disabledText : theme.color.onAccent}
              />
            ) : (
              <>
                <Text style={[styles.primaryButtonText, { color: theme.color.onAccent }]}>
                  {t('auth.signup.cta_primary')}
                </Text>
                <MaterialIcons color={theme.color.onAccent} name="arrow-forward" size={20} />
              </>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: theme.color.border }]} />
            <Text style={[styles.dividerText, { color: palette.icon }]}>
              {t('auth.signup.or_continue')}
            </Text>
            <View style={[styles.dividerLine, { backgroundColor: theme.color.border }]} />
          </View>

          <View style={styles.socialRow}>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={onGoogleCreateAccount}
              style={[
                styles.socialButton,
                {
                  backgroundColor: submitting ? theme.color.disabledSurface : theme.color.surface,
                  borderColor: submitting ? theme.color.disabledBorder : theme.color.textTertiary,
                },
              ]}
              testID="auth.createAccount.googleButton"
            >
              <AntDesign
                name="google"
                size={20}
                color={submitting ? theme.color.disabledText : theme.color.accentPrimary}
              />
              <Text
                style={[
                  styles.socialButtonText,
                  { color: submitting ? theme.color.disabledText : palette.text },
                ]}
              >
                {t('auth.social.google')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={onAppleCreateAccount}
              style={[
                styles.socialButton,
                {
                  backgroundColor: submitting ? theme.color.disabledSurface : theme.color.surface,
                  borderColor: submitting ? theme.color.disabledBorder : theme.color.textTertiary,
                },
              ]}
              testID="auth.createAccount.appleButton"
            >
              <Ionicons
                name="logo-apple"
                size={20}
                color={submitting ? theme.color.disabledText : palette.text}
              />
              <Text
                style={[
                  styles.socialButtonText,
                  { color: submitting ? theme.color.disabledText : palette.text },
                ]}
              >
                {t('auth.social.apple')}
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace(buildAuthRoute('/auth/sign-in') as never)}
          style={[styles.secondaryButton, usesCompactMobileLayout && styles.secondaryButtonCompact]}
          testID="auth.createAccount.backToSignInButton"
          disabled={submitting}
        >
          <Text style={[styles.secondaryButtonHint, { color: palette.icon }]}>
            {t('auth.signup.already_have')}
          </Text>
          <Text style={[styles.secondaryButtonText, { color: palette.tint }]}>
            {t('auth.signup.cta_back_signin')}
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
    flex: 1,
  },
  contentContainer: {
    alignSelf: 'center',
    flexGrow: 1,
    maxWidth: 560,
    paddingHorizontal: 20,
    width: '100%',
  },
  contentContainerCompact: {
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  headerBrandMark: {
    alignItems: 'center',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerBrandLogo: {
    height: 30,
    width: 30,
  },
  headerSpacer: {
    width: 44,
  },
  titleArea: {
    alignItems: 'flex-start',
    marginBottom: 24,
    marginTop: 20,
  },
  titleAreaCompact: {
    marginBottom: 18,
    marginTop: 16,
  },
  formWrapper: {
    gap: 16,
  },
  formWrapperCompact: {
    gap: 12,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    maxWidth: 330,
    textAlign: 'left',
  },
  titleCompact: {
    fontSize: 26,
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 330,
  },
  formSection: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  passwordRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  passwordInput: {
    flex: 1,
    paddingRight: 12,
  },
  passwordToggle: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: -2,
    paddingHorizontal: 0,
  },
  inlineError: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 0,
  },
  submitError: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 20,
    paddingHorizontal: 0,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 52,
    marginTop: 4,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 14,
    lineHeight: 20,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  socialButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  socialButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 26,
    paddingBottom: 8,
    paddingTop: 8,
  },
  secondaryButtonCompact: {
    marginTop: 10,
    paddingBottom: 4,
    paddingTop: 4,
  },
  secondaryButtonHint: {
    fontSize: 14,
    fontWeight: '500',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
