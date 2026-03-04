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
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GoogleAuthProvider, OAuthProvider, signInWithEmailAndPassword } from 'firebase/auth';

import { Colors, Fonts } from '@/constants/theme';
import { signInOrLinkWithCredential } from '@/features/auth/firebase-social-auth';
import { getFirebaseAuth, firebaseOAuthConfig } from '@/features/auth/firebase';
import {
  mapSignInReasonToMessageKey,
  normalizeSignInReason,
  type SignInErrorMessageKey,
  type SignInRequest,
  validateSignInInput,
  type SignInValidationErrors,
} from '@/features/auth/sign-in.logic';
import {
  buildAuthEntryViewed,
  buildSignInFailed,
  buildSignInSubmitted,
} from '@/features/analytics/analytics.logic';
import { useAnalytics } from '@/features/analytics/use-analytics';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

WebBrowser.maybeCompleteAuthSession();

function createNonce(length = 32) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return value;
}

export default function SignInScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const { t } = useTranslation();
  const { emitEvent } = useAnalytics();
  const [googleRequest, googleResponse, promptGoogle] = Google.useAuthRequest({
    iosClientId: firebaseOAuthConfig.iosClientId,
    androidClientId: firebaseOAuthConfig.androidClientId,
    webClientId: firebaseOAuthConfig.webClientId,
  });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<SignInValidationErrors>({});
  const [submitError, setSubmitError] = useState<SignInErrorMessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    emitEvent(buildAuthEntryViewed('auth_sign_in'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onEmailPasswordSignIn = async () => {
    const nextErrors = validateSignInInput({ email, password });
    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    emitEvent(buildSignInSubmitted('email_password'));
    setSubmitting(true);
    try {
      await signInWithEmailPassword({ email, password });
      router.replace('/auth/role-selection');
    } catch (error: unknown) {
      const reason = normalizeSignInReason(error);
      emitEvent(buildSignInFailed('email_password', reason));
      setSubmitError(mapSignInReasonToMessageKey(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleSignIn = async () => {
    setSubmitError(null);
    emitEvent(buildSignInSubmitted('google'));

    try {
      await promptGoogle();
    } catch (error: unknown) {
      const reason = normalizeSignInReason(error);
      emitEvent(buildSignInFailed('google', reason));
      setSubmitError(mapSignInReasonToMessageKey(reason));
    }
  };

  const onAppleSignIn = async () => {
    setSubmitError(null);
    emitEvent(buildSignInSubmitted('apple'));

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
      router.replace('/auth/role-selection');
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
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

  useEffect(() => {
    if (googleResponse?.type !== 'success') {
      return;
    }

    const idToken =
      googleResponse.authentication?.idToken ||
      (typeof googleResponse.params?.id_token === 'string' ? googleResponse.params.id_token : '');
    if (!idToken) {
      emitEvent(buildSignInFailed('google', 'missing_id_token'));
      setSubmitError('common.error.generic');
      return;
    }

    setSubmitting(true);
    void signInOrLinkWithCredential(GoogleAuthProvider.credential(idToken))
      .then(() => {
        router.replace('/auth/role-selection');
      })
      .catch((error: unknown) => {
        const reason = normalizeSignInReason(error);
        emitEvent(buildSignInFailed('google', reason));
        setSubmitError(mapSignInReasonToMessageKey(reason));
      })
      .finally(() => {
        setSubmitting(false);
      });
  }, [googleResponse, router, emitEvent]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: isDark ? '#221410' : '#fff5f0' }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}>
      <Stack.Screen options={{ title: t('auth.signin.cta_primary'), headerShown: false }} />

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

      <View style={styles.content}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }

              router.replace('/');
            }}
            style={[styles.backButton, { backgroundColor: isDark ? '#2a1f1b' : '#ffffff' }]}
            testID="auth.signIn.backButton">
            <MaterialIcons color={palette.text} name="arrow-back" size={22} />
          </Pressable>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.titleArea}>
          <View style={[styles.brandBadge, { backgroundColor: isDark ? '#2a1f1b' : '#ffffff' }]}>
            <MaterialIcons color="#ff7b72" name="fitness-center" size={34} />
          </View>
          <Text testID="auth.signIn.title" style={[styles.title, { color: palette.text }]}>
            {t('auth.signin.title')}
          </Text>
          <Text style={[styles.subtitle, { color: palette.icon }]}>{t('auth.signin.subtitle')}</Text>
        </View>

        <View style={styles.formWrapper}>
          <View style={styles.formSection}>
            <Text style={[styles.fieldLabel, { color: palette.text }]}>{t('auth.signin.field.email')}</Text>
            <TextInput
              accessibilityLabel={t('auth.signin.field.email')}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder={t('auth.signin.placeholder.email')}
              placeholderTextColor={palette.icon}
              style={[
                styles.input,
                { backgroundColor: isDark ? '#2a1f1b' : '#ffffff', borderColor: 'transparent', color: palette.text },
              ]}
              testID="auth.signIn.emailInput"
              value={email}
            />
            <View accessibilityLiveRegion="polite">
              {errors.email ? (
                <Text style={styles.inlineError} testID="auth.signIn.error.emailRequired">
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
                autoComplete="password"
                onChangeText={setPassword}
                placeholder={t('auth.signin.placeholder.password')}
                placeholderTextColor={palette.icon}
                secureTextEntry={!showPassword}
                style={[
                  styles.input,
                  styles.passwordInput,
                  {
                    backgroundColor: isDark ? '#2a1f1b' : '#ffffff',
                    borderColor: 'transparent',
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
                style={[styles.passwordToggle, { backgroundColor: isDark ? '#352a25' : '#f8f1ed' }]}>
                <Text style={[styles.passwordToggleText, { color: palette.text }]}>
                  {showPassword ? t('auth.password.toggle_hide_short') : t('auth.password.toggle_show_short')}
                </Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={onEmailPasswordSignIn}
              disabled={submitting}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  opacity: submitting ? 0.7 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
              testID="auth.signIn.submitButton">
              {submitting ? (
                <ActivityIndicator
                  accessibilityLabel={t('a11y.loading.submitting')}
                  color="#ffffff"
                />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>{t('auth.signin.cta_primary')}</Text>
                  <MaterialIcons color="#ffffff" name="arrow-forward" size={20} />
                </>
              )}
            </Pressable>

            <View accessibilityLiveRegion="polite">
              {errors.password ? (
                <Text style={styles.inlineError} testID="auth.signIn.error.passwordRequired">
                  {t(errors.password)}
                </Text>
              ) : null}
            </View>

            <View accessibilityRole="alert">
              {submitError ? (
                <Text style={styles.submitError} testID="auth.signIn.error.submit">
                  {t(submitError)}
                </Text>
              ) : null}
            </View>
          </View>

          <Text style={[styles.dividerText, { color: palette.icon }]}>{t('auth.signin.or_continue')}</Text>

          <View style={styles.socialRow}>
            <Pressable
              accessibilityRole="button"
              disabled={submitting || !googleRequest}
              onPress={onGoogleSignIn}
              style={[
                styles.socialButton,
                {
                  backgroundColor: isDark ? '#2a1f1b' : '#ffffff',
                  opacity: submitting || !googleRequest ? 0.5 : 1,
                },
              ]}
              testID="auth.signIn.googleButton">
              <Text style={[styles.socialButtonText, { color: '#ea4335' }]}>
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
                  backgroundColor: isDark ? '#2a1f1b' : '#ffffff',
                  opacity: submitting ? 0.5 : 1,
                },
              ]}
              testID="auth.signIn.appleButton">
              <Text style={[styles.socialButtonText, { color: palette.text }]}>{t('auth.social.apple')}</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/auth/create-account')}
          testID="auth.signIn.createAccountButton"
          style={styles.secondaryButton}
          disabled={submitting}>
          <Text style={[styles.secondaryButtonHint, { color: palette.icon }]}>{t('auth.signin.new_here')}</Text>
          <Text style={[styles.secondaryButtonText, { color: palette.tint }]}>{t('auth.signin.cta_create')}</Text>
        </Pressable>
      </View>
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
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 14,
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
    marginBottom: 24,
    marginTop: 30,
  },
  brandBadge: {
    alignItems: 'center',
    borderColor: 'rgba(255,123,114,0.25)',
    borderRadius: 50,
    borderWidth: 4,
    elevation: 2,
    height: 100,
    justifyContent: 'center',
    marginBottom: 16,
    width: 100,
  },
  formWrapper: {
    gap: 14,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    marginTop: 6,
    textAlign: 'center',
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
    color: '#b3261e',
    fontSize: 13,
    paddingHorizontal: 12,
  },
  submitError: {
    color: '#b3261e',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    marginTop: 2,
    paddingHorizontal: 12,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#ff7b72',
    borderRadius: 28,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 56,
    marginTop: 2,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  dividerText: {
    alignSelf: 'center',
    fontSize: 14,
    marginTop: 6,
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
    marginTop: 'auto',
    paddingBottom: 8,
    paddingTop: 24,
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

async function signInWithEmailPassword(input: SignInRequest): Promise<void> {
  const auth = getFirebaseAuth();
  await signInWithEmailAndPassword(auth, input.email.trim().toLowerCase(), input.password);
}
