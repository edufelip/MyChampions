import { Stack, useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
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
import { createUserWithEmailAndPassword, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';

import { getDsTheme } from '@/constants/design-system';
import { Colors, Fonts } from '@/constants/theme';
import {
  mapCreateAccountReasonToMessageKey,
  normalizeCreateAccountReason,
  type CreateAccountErrorMessageKey,
  type CreateAccountRequest,
  validateCreateAccountInput,
  type CreateAccountValidationErrors,
} from '@/features/auth/create-account.logic';
import { signInOrLinkWithCredential } from '@/features/auth/firebase-social-auth';
import { getFirebaseAuth, firebaseOAuthConfig } from '@/features/auth/firebase';
import {
  buildAuthEntryViewed,
  buildSignUpFailed,
  buildSignUpSubmitted,
} from '@/features/analytics/analytics.logic';
import { useAnalytics } from '@/features/analytics/use-analytics';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

WebBrowser.maybeCompleteAuthSession();

function createNonce(length = 32) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return value;
}

export default function CreateAccountScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const palette = Colors[colorScheme];
  const router = useRouter();
  const { t } = useTranslation();
  const { emitEvent } = useAnalytics();
  const insets = useSafeAreaInsets();
  const [googleRequest, googleResponse, promptGoogle] = Google.useAuthRequest({
    iosClientId: firebaseOAuthConfig.iosClientId,
    androidClientId: firebaseOAuthConfig.androidClientId,
    webClientId: firebaseOAuthConfig.webClientId,
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [errors, setErrors] = useState<CreateAccountValidationErrors>({});
  const [submitError, setSubmitError] = useState<CreateAccountErrorMessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    emitEvent(buildAuthEntryViewed('auth_create_account'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreateAccount = async () => {
    const nextErrors = validateCreateAccountInput({ name, email, password, passwordConfirmation });
    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    emitEvent(buildSignUpSubmitted('email_password'));
    setSubmitting(true);
    try {
      await createAccountWithEmailPassword({ name, email, password, passwordConfirmation });
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
      await promptGoogle();
    } catch (error: unknown) {
      const reason = normalizeCreateAccountReason(error);
      emitEvent(buildSignUpFailed('google', reason));
      setSubmitError(mapCreateAccountReasonToMessageKey(reason));
    }
  };

  const onAppleCreateAccount = async () => {
    setSubmitError(null);
    emitEvent(buildSignUpSubmitted('apple'));

    try {
      if (Platform.OS !== 'ios') {
        throw new Error('Apple Sign-In is only available on iOS.');
      }

      const nonce = createNonce();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashedNonce,
      });

      if (!appleCredential.identityToken) {
        throw new Error('Apple identity token is missing.');
      }

      setSubmitting(true);
      const provider = new OAuthProvider('apple.com');
      const firebaseCredential = provider.credential({
        idToken: appleCredential.identityToken,
        rawNonce: nonce,
      });
      await signInOrLinkWithCredential(firebaseCredential);
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
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

  useEffect(() => {
    if (googleResponse?.type !== 'success') {
      return;
    }

    const idToken =
      googleResponse.authentication?.idToken ||
      (typeof googleResponse.params?.id_token === 'string' ? googleResponse.params.id_token : '');
    if (!idToken) {
      emitEvent(buildSignUpFailed('google', 'missing_id_token'));
      setSubmitError('common.error.generic');
      return;
    }

    setSubmitting(true);
    void signInOrLinkWithCredential(GoogleAuthProvider.credential(idToken))
      .then(() => {})
      .catch((error: unknown) => {
        const reason = normalizeCreateAccountReason(error);
        emitEvent(buildSignUpFailed('google', reason));
        setSubmitError(mapCreateAccountReasonToMessageKey(reason));
      })
      .finally(() => {
        setSubmitting(false);
      });
  }, [googleResponse, router, emitEvent]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      testID="auth.createAccount.screen">
      <Stack.Screen options={{ title: t('auth.signup.title'), headerShown: false }} />

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

      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentContainer, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
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
            testID="auth.createAccount.backButton">
            <MaterialIcons color={palette.text} name="arrow-back" size={22} />
          </Pressable>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.titleArea}>
          <View style={[styles.brandBadge, { backgroundColor: theme.color.surface, borderColor: theme.color.accentPrimarySoft }]}>
            <MaterialIcons color={theme.color.accentPrimary} name="fitness-center" size={32} />
          </View>
          <Text style={[styles.title, { color: palette.text }]} testID="auth.createAccount.title">
            {t('auth.signup.title')}
          </Text>
        </View>

        <View style={styles.formWrapper}>
          <View style={styles.formSection}>
            <Text style={[styles.fieldLabel, { color: palette.text }]}>{t('auth.field.name')}</Text>
            <TextInput
              accessibilityLabel={t('auth.field.name')}
              autoCapitalize="words"
              autoComplete="name"
              onChangeText={setName}
              placeholder={t('auth.placeholder.name')}
              placeholderTextColor={palette.icon}
              style={[
                styles.input,
                { backgroundColor: theme.color.surface, borderColor: 'transparent', color: palette.text },
              ]}
              testID="auth.createAccount.nameInput"
              value={name}
            />
            <View accessibilityLiveRegion="polite">
              {errors.name ? (
                <Text style={[styles.inlineError, { color: theme.color.danger }]} testID="auth.createAccount.error.nameRequired">
                  {t(errors.name)}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.formSection}>
            <Text style={[styles.fieldLabel, { color: palette.text }]}>{t('auth.field.email')}</Text>
            <TextInput
              accessibilityLabel={t('auth.field.email')}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder={t('auth.placeholder.email')}
              placeholderTextColor={palette.icon}
              style={[
                styles.input,
                { backgroundColor: theme.color.surface, borderColor: 'transparent', color: palette.text },
              ]}
              testID="auth.createAccount.emailInput"
              value={email}
            />
            <View accessibilityLiveRegion="polite">
              {errors.email ? (
                <Text style={[styles.inlineError, { color: theme.color.danger }]} testID="auth.createAccount.error.emailRequired">
                  {t(errors.email)}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.formSection}>
            <Text style={[styles.fieldLabel, { color: palette.text }]}>{t('auth.field.password')}</Text>
            <View style={styles.passwordRow}>
              <TextInput
                accessibilityLabel={t('auth.field.password')}
                autoCapitalize="none"
                autoComplete="password-new"
                onChangeText={setPassword}
                placeholder={t('auth.placeholder.password')}
                placeholderTextColor={palette.icon}
                secureTextEntry={!showPassword}
                style={[
                  styles.input,
                  styles.passwordInput,
                  {
                    backgroundColor: theme.color.surface,
                    borderColor: 'transparent',
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
                style={[styles.passwordToggle, { backgroundColor: theme.color.surfaceMuted }]}>
                <Text style={[styles.passwordToggleText, { color: palette.text }]}>
                  {showPassword ? t('auth.password.toggle_hide_short') : t('auth.password.toggle_show_short')}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.helperText, { color: palette.icon }]}>{t('auth.signup.password_helper')}</Text>
            <View accessibilityLiveRegion="polite">
              {errors.password ? (
                <Text style={[styles.inlineError, { color: theme.color.danger }]} testID="auth.createAccount.error.password">
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
                onChangeText={setPasswordConfirmation}
                placeholder={t('auth.placeholder.password_confirmation')}
                placeholderTextColor={palette.icon}
                secureTextEntry={!showPasswordConfirmation}
                style={[
                  styles.input,
                  styles.passwordInput,
                  {
                    backgroundColor: theme.color.surface,
                    borderColor: 'transparent',
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
                style={[styles.passwordToggle, { backgroundColor: theme.color.surfaceMuted }]}>
                <Text style={[styles.passwordToggleText, { color: palette.text }]}>
                  {showPasswordConfirmation
                    ? t('auth.password.toggle_hide_short')
                    : t('auth.password.toggle_show_short')}
                </Text>
              </Pressable>
            </View>
            <View accessibilityLiveRegion="polite">
              {errors.passwordConfirmation ? (
                <Text style={[styles.inlineError, { color: theme.color.danger }]} testID="auth.createAccount.error.passwordConfirmation">
                  {t(errors.passwordConfirmation)}
                </Text>
              ) : null}
            </View>
          </View>

          <View accessibilityRole="alert">
            {submitError ? (
              <Text style={[styles.submitError, { color: theme.color.danger }]} testID="auth.createAccount.error.submit">
                {t(submitError)}
              </Text>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={onCreateAccount}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: theme.color.accentPrimary,
                opacity: submitting ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
            ]}
            testID="auth.createAccount.submitButton">
            {submitting ? (
              <ActivityIndicator
                accessibilityLabel={t('a11y.loading.submitting')}
                color={theme.color.onAccent}
              />
            ) : (
              <>
                <Text style={[styles.primaryButtonText, { color: theme.color.onAccent }]}>{t('auth.signup.cta_primary')}</Text>
                <MaterialIcons color={theme.color.onAccent} name="arrow-forward" size={20} />
              </>
            )}
          </Pressable>

          <Text style={[styles.dividerText, { color: palette.icon }]}>{t('auth.signup.or_continue')}</Text>

          <View style={styles.socialRow}>
            <Pressable
              accessibilityRole="button"
              disabled={submitting || !googleRequest}
              onPress={onGoogleCreateAccount}
              style={[
                styles.socialButton,
                {
                  backgroundColor: theme.color.surface,
                  opacity: submitting || !googleRequest ? 0.5 : 1,
                },
              ]}
              testID="auth.createAccount.googleButton">
              <Text style={[styles.socialButtonText, { color: theme.color.accentBlue }]}>{t('auth.social.google')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={onAppleCreateAccount}
              style={[
                styles.socialButton,
                {
                  backgroundColor: theme.color.surface,
                  opacity: submitting ? 0.5 : 1,
                },
              ]}
              testID="auth.createAccount.appleButton">
              <Text style={[styles.socialButtonText, { color: palette.text }]}>{t('auth.social.apple')}</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/auth/sign-in')}
          style={styles.secondaryButton}
          testID="auth.createAccount.backToSignInButton"
          disabled={submitting}>
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
  },
  contentContainer: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 24,
    elevation: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  headerSpacer: {
    width: 48,
  },
  titleArea: {
    alignItems: 'center',
    marginBottom: 18,
    marginTop: 20,
  },
  brandBadge: {
    alignItems: 'center',
    borderRadius: 44,
    borderWidth: 4,
    elevation: 2,
    height: 88,
    justifyContent: 'center',
    marginBottom: 12,
    width: 88,
  },
  formWrapper: {
    gap: 12,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'center',
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
    minHeight: 56,
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
  helperText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: -2,
    paddingHorizontal: 12,
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
  dividerText: {
    alignSelf: 'center',
    fontSize: 14,
    marginTop: 4,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  socialButton: {
    alignItems: 'center',
    borderRadius: 28,
    flex: 1,
    justifyContent: 'center',
    minHeight: 56,
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
    marginTop: 24,
    paddingBottom: 8,
    paddingTop: 8,
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

async function createAccountWithEmailPassword(input: CreateAccountRequest): Promise<void> {
  const auth = getFirebaseAuth();
  await createUserWithEmailAndPassword(auth, input.email.trim().toLowerCase(), input.password);
}
