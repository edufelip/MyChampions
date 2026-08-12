import { AntDesign, Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDsTheme } from '@/constants/design-system';
import { Colors, Fonts } from '@/constants/theme';
import {
  buildAuthEntryViewed,
  buildSignInFailed,
  buildSignInSubmitted,
} from '@/features/analytics/analytics.logic';
import { useAnalytics } from '@/features/analytics/use-analytics';
import { signInWithAppleProviderTokenFromSource } from '@/features/auth/apple-social-auth-source';
import { normalizeAuthReturnTo } from '@/features/auth/auth-route-guard.logic';
import { useAuthSession } from '@/features/auth/auth-session';
import { signInWithEmailPasswordFromSource } from '@/features/auth/email-auth-source';
import { signInWithGoogleProviderTokenFromSource } from '@/features/auth/google-social-auth-source';
import {
  SignInFailure,
  mapSignInReasonToMessageKey,
  normalizeSignInReason,
  resolveSignInValidationAnalyticsReason,
  type SignInErrorMessageKey,
  validateSignInInput,
  type SignInValidationErrors,
} from '@/features/auth/sign-in.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function SignInScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const palette = Colors[colorScheme];
  const primaryButtonForeground = theme.color.onAccent;
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = normalizeAuthReturnTo(searchParams.returnTo);
  const { t } = useTranslation();
  const { emitEvent } = useAnalytics();
  const {
    signInWithE2EEmailPassword,
    signInWithE2ESocialAuth,
    signInWithServerSocialAuth,
    adoptCurrentServerSession,
  } = useAuthSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const emailRef = useRef('');
  const passwordRef = useRef('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<SignInValidationErrors>({});
  const [submitError, setSubmitError] = useState<SignInErrorMessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);
  const insets = useSafeAreaInsets();

  const buildAuthRoute = (pathname: '/auth/create-account') => {
    if (!returnTo) {
      return pathname;
    }

    return { pathname, params: { returnTo } };
  };

  useEffect(() => {
    emitEvent(buildAuthEntryViewed('auth_sign_in'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const onEmailChange = (value: string) => {
    emailRef.current = value;
    setEmail(value);
  };

  const onPasswordChange = (value: string) => {
    passwordRef.current = value;
    setPassword(value);
  };

  const onEmailPasswordSignIn = async (submittedPassword?: string) => {
    const submissionInput = {
      email: emailRef.current,
      password: submittedPassword ?? passwordRef.current,
    };
    const nextErrors = validateSignInInput(submissionInput);
    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0) {
      const validationReason = resolveSignInValidationAnalyticsReason(nextErrors);
      if (validationReason) {
        emitEvent(buildSignInFailed('email_password', validationReason));
      }
      return;
    }

    emitEvent(buildSignInSubmitted('email_password'));
    setSubmitting(true);
    try {
      if (await signInWithE2EEmailPassword(submissionInput.email, submissionInput.password)) {
        return;
      }
      await signInWithEmailPasswordFromSource(submissionInput);
      if (!adoptCurrentServerSession()) throw new SignInFailure('unknown');
    } catch (error: unknown) {
      const reason = normalizeSignInReason(error);
      emitEvent(buildSignInFailed('email_password', reason));
      setSubmitError(mapSignInReasonToMessageKey(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleSignIn = async () => {
    if (submitting) return;
    setSubmitError(null);
    emitEvent(buildSignInSubmitted('google'));
    setSubmitting(true);

    try {
      if (await signInWithE2ESocialAuth('google')) {
        return;
      }
      try {
        await signInWithGoogleProviderTokenFromSource();
        if (!adoptCurrentServerSession()) throw new SignInFailure('unknown');
        return;
      } catch (error: unknown) {
        if (normalizeSignInReason(error) !== 'configuration') {
          throw error;
        }
      }
      if (await signInWithServerSocialAuth('google')) {
        return;
      }

      throw new SignInFailure('configuration');
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code.includes('ERR_REQUEST_CANCELED')) {
        return;
      }

      const reason = normalizeSignInReason(error);
      emitEvent(buildSignInFailed('google', reason));
      setSubmitError(mapSignInReasonToMessageKey(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const onAppleSignIn = async () => {
    if (submitting) return;
    setSubmitError(null);
    emitEvent(buildSignInSubmitted('apple'));
    setSubmitting(true);

    try {
      if (await signInWithE2ESocialAuth('apple')) {
        return;
      }
      try {
        await signInWithAppleProviderTokenFromSource();
        if (!adoptCurrentServerSession()) throw new SignInFailure('unknown');
        return;
      } catch (error: unknown) {
        if (normalizeSignInReason(error) !== 'configuration') {
          throw error;
        }
      }
      if (await signInWithServerSocialAuth('apple')) {
        return;
      }

      throw new SignInFailure('configuration');
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code.includes('ERR_REQUEST_CANCELED')) {
        return;
      }

      const reason = normalizeSignInReason(error);
      emitEvent(buildSignInFailed('apple', reason));
      setSubmitError(mapSignInReasonToMessageKey(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
    >
      <Stack.Screen options={{ title: t('auth.signin.cta_primary'), headerShown: false }} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28, paddingTop: insets.top + 24 },
        ]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="auth.signIn.scrollView"
      >
        <View
          style={[styles.titleArea, isKeyboardVisible ? styles.titleAreaKeyboardVisible : null]}
        >
          <View
            style={[
              styles.brandMark,
              isKeyboardVisible ? styles.brandMarkKeyboardVisible : null,
              { backgroundColor: theme.color.accentPrimarySoft },
            ]}
          >
            <Image
              accessibilityLabel={t('a11y.brand_logo')}
              contentFit="contain"
              source={require('../../assets/images/logo.svg')}
              style={styles.brandLogo}
            />
          </View>
          <Text testID="auth.signIn.title" style={[styles.title, { color: palette.text }]}>
            {t('auth.signin.title')}
          </Text>
          <Text style={[styles.subtitle, { color: palette.icon }]}>
            {t('auth.signin.subtitle')}
          </Text>
        </View>

        <View style={styles.formWrapper}>
          <View style={styles.formSection}>
            <Text style={[styles.fieldLabel, { color: palette.text }]}>
              {t('auth.signin.field.email')}
            </Text>
            <TextInput
              accessibilityLabel={t('auth.signin.field.email')}
              autoCapitalize="none"
              autoComplete="email"
              onBlur={() => setFocusedField(null)}
              keyboardType="email-address"
              onChangeText={onEmailChange}
              onFocus={() => setFocusedField('email')}
              placeholder={t('auth.signin.placeholder.email')}
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
              testID="auth.signIn.emailInput"
              value={email}
            />
            <View accessibilityLiveRegion="polite">
              {errors.email ? (
                <Text
                  style={[styles.inlineError, { color: theme.color.danger }]}
                  testID="auth.signIn.error.emailRequired"
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
            <View style={styles.passwordField}>
              <TextInput
                accessibilityLabel={t('auth.field.password')}
                autoCapitalize="none"
                autoComplete="password"
                onBlur={() => setFocusedField(null)}
                onChangeText={onPasswordChange}
                onFocus={() => setFocusedField('password')}
                onSubmitEditing={({ nativeEvent }) => {
                  void onEmailPasswordSignIn(nativeEvent.text);
                }}
                placeholder={t('auth.signin.placeholder.password')}
                placeholderTextColor={palette.icon}
                returnKeyType="done"
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
                testID="auth.signIn.passwordInput"
                value={password}
              />
              <Pressable
                accessibilityLabel={
                  showPassword ? t('auth.password.toggle_hide') : t('auth.password.toggle_show')
                }
                accessibilityRole="button"
                onPress={() => setShowPassword((current) => !current)}
                testID="auth.signIn.passwordToggle"
                style={[
                  styles.passwordIconButton,
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
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void onEmailPasswordSignIn();
              }}
              disabled={submitting}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: submitting
                    ? theme.color.disabledSurface
                    : theme.color.accentPrimary,
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                },
              ]}
              testID="auth.signIn.submitButton"
            >
              {submitting ? (
                <ActivityIndicator
                  accessibilityLabel={t('a11y.loading.submitting')}
                  color={submitting ? theme.color.disabledText : primaryButtonForeground}
                />
              ) : (
                <>
                  <Text style={[styles.primaryButtonText, { color: primaryButtonForeground }]}>
                    {t('auth.signin.cta_primary')}
                  </Text>
                  <MaterialIcons color={primaryButtonForeground} name="arrow-forward" size={20} />
                </>
              )}
            </Pressable>

            <View accessibilityLiveRegion="polite">
              {errors.password ? (
                <Text
                  style={[styles.inlineError, { color: theme.color.danger }]}
                  testID="auth.signIn.error.passwordRequired"
                >
                  {t(errors.password)}
                </Text>
              ) : null}
            </View>

            <View accessibilityRole="alert">
              {submitError ? (
                <Text
                  style={[styles.submitError, { color: theme.color.danger }]}
                  testID="auth.signIn.error.submit"
                >
                  {t(submitError)}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: theme.color.border }]} />
            <Text style={[styles.dividerText, { color: palette.icon }]}>
              {t('auth.signin.or_continue')}
            </Text>
            <View style={[styles.dividerLine, { backgroundColor: theme.color.border }]} />
          </View>

          <View style={styles.socialRow}>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={onGoogleSignIn}
              style={[
                styles.socialButton,
                {
                  backgroundColor: submitting ? theme.color.disabledSurface : theme.color.surface,
                  borderColor: submitting ? theme.color.disabledBorder : theme.color.textTertiary,
                },
              ]}
              testID="auth.signIn.googleButton"
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
              onPress={onAppleSignIn}
              style={[
                styles.socialButton,
                {
                  backgroundColor: submitting ? theme.color.disabledSurface : theme.color.surface,
                  borderColor: submitting ? theme.color.disabledBorder : theme.color.textTertiary,
                },
              ]}
              testID="auth.signIn.appleButton"
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
          onPress={() => router.push(buildAuthRoute('/auth/create-account') as never)}
          testID="auth.signIn.createAccountButton"
          style={styles.secondaryButton}
          disabled={submitting}
        >
          <Text style={[styles.secondaryButtonHint, { color: palette.icon }]}>
            {t('auth.signin.new_here')}
          </Text>
          <Text style={[styles.secondaryButtonText, { color: palette.tint }]}>
            {t('auth.signin.cta_create')}
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
  },
  titleArea: {
    alignItems: 'flex-start',
    marginBottom: 28,
    marginTop: 16,
  },
  titleAreaKeyboardVisible: {
    marginBottom: 20,
    marginTop: 0,
  },
  brandMark: {
    alignItems: 'center',
    borderRadius: 16,
    height: 64,
    justifyContent: 'center',
    marginBottom: 20,
    width: 64,
  },
  brandMarkKeyboardVisible: {
    height: 48,
    marginBottom: 14,
    width: 48,
  },
  brandLogo: {
    borderRadius: 12,
    height: 48,
    overflow: 'hidden',
    width: 48,
  },
  formWrapper: {
    gap: 18,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    maxWidth: 330,
    textAlign: 'left',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 330,
    textAlign: 'left',
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
  passwordField: {
    justifyContent: 'center',
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 58,
  },
  passwordIconButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    height: 44,
    position: 'absolute',
    right: 10,
    width: 44,
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
    marginTop: 4,
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
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 26,
    paddingBottom: 8,
    paddingTop: 20,
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
