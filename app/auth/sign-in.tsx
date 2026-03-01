import { Stack, useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
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
  const router = useRouter();
  const { t } = useTranslation();
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

  const onEmailPasswordSignIn = async () => {
    const nextErrors = validateSignInInput({ email, password });
    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      await signInWithEmailPassword({ email, password });
      router.replace('/auth/role-selection');
    } catch (error: unknown) {
      const reason = normalizeSignInReason(error);
      setSubmitError(mapSignInReasonToMessageKey(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleSignIn = async () => {
    setSubmitError(null);

    try {
      await promptGoogle();
    } catch (error: unknown) {
      const reason = normalizeSignInReason(error);
      setSubmitError(mapSignInReasonToMessageKey(reason));
    }
  };

  const onAppleSignIn = async () => {
    setSubmitError(null);

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
        setSubmitError(mapSignInReasonToMessageKey(reason));
      })
      .finally(() => {
        setSubmitting(false);
      });
  }, [googleResponse, router]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: palette.background }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}>
      <Stack.Screen options={{ title: t('auth.signin.cta_primary'), headerShown: false }} />

      <View style={styles.content}>
        <Text testID="auth.signIn.title" style={[styles.title, { color: palette.text }]}>
          {t('auth.signin.title')}
        </Text>

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
            style={[styles.input, { borderColor: palette.icon, color: palette.text }]}
            testID="auth.signIn.emailInput"
            value={email}
          />
          {errors.email ? (
            <Text style={styles.inlineError} testID="auth.signIn.error.emailRequired">
              {t(errors.email)}
            </Text>
          ) : null}
        </View>

        <View style={styles.formSection}>
          <Text style={[styles.fieldLabel, { color: palette.text }]}>{t('auth.field.password')}</Text>
          <View style={styles.passwordRow}>
            <TextInput
              accessibilityLabel={t('auth.field.password')}
              autoCapitalize="none"
              autoComplete="password"
              onChangeText={setPassword}
              placeholder={t('auth.placeholder.password')}
              placeholderTextColor={palette.icon}
              secureTextEntry={!showPassword}
              style={[styles.input, styles.passwordInput, { borderColor: palette.icon, color: palette.text }]}
              testID="auth.signIn.passwordInput"
              value={password}
            />
            <Pressable
              accessibilityLabel={
                showPassword ? t('auth.password.toggle_hide') : t('auth.password.toggle_show')
              }
              onPress={() => setShowPassword((current) => !current)}
              testID="auth.signIn.passwordToggle"
              style={[styles.passwordToggle, { borderColor: palette.icon }]}>
              <Text style={[styles.passwordToggleText, { color: palette.text }]}>
                {showPassword ? t('auth.password.toggle_hide_short') : t('auth.password.toggle_show_short')}
              </Text>
            </Pressable>
          </View>
          {errors.password ? (
            <Text style={styles.inlineError} testID="auth.signIn.error.passwordRequired">
              {t(errors.password)}
            </Text>
          ) : null}
        </View>

        {submitError ? (
          <Text style={styles.submitError} testID="auth.signIn.error.submit">
            {t(submitError)}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={onEmailPasswordSignIn}
          testID="auth.signIn.submitButton"
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: palette.tint,
              opacity: submitting ? 0.7 : pressed ? 0.85 : 1,
            },
          ]}>
          {submitting ? (
            <ActivityIndicator color={colorScheme === 'dark' ? '#11181C' : '#ffffff'} />
          ) : (
            <Text style={styles.primaryButtonText}>{t('auth.signin.cta_primary')}</Text>
          )}
        </Pressable>

        <Text style={[styles.dividerText, { color: palette.icon }]}>{t('auth.signin.or_continue')}</Text>

        <View style={styles.socialRow}>
          <Pressable
            accessibilityRole="button"
            disabled={submitting || !googleRequest}
            onPress={onGoogleSignIn}
            testID="auth.signIn.googleButton"
            style={[styles.socialButton, { borderColor: palette.icon }]}>
            <Text style={[styles.socialButtonText, { color: palette.text }]}>{t('auth.social.google')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={onAppleSignIn}
            testID="auth.signIn.appleButton"
            style={[styles.socialButton, { borderColor: palette.icon }]}>
            <Text style={[styles.socialButtonText, { color: palette.text }]}>{t('auth.social.apple')}</Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/auth/create-account')}
          testID="auth.signIn.createAccountButton"
          style={styles.secondaryButton}>
          <Text style={[styles.secondaryButtonText, { color: palette.tint }]}>
            {t('auth.signin.cta_create')}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  content: {
    gap: 16,
    marginBottom: 20,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 8,
  },
  formSection: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  passwordRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  passwordInput: {
    flex: 1,
  },
  passwordToggle: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  passwordToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  inlineError: {
    color: '#b3261e',
    fontSize: 13,
  },
  submitError: {
    color: '#b3261e',
    fontSize: 14,
    fontWeight: '500',
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
  dividerText: {
    alignSelf: 'center',
    fontSize: 14,
    marginTop: 6,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 8,
  },
  socialButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  socialButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

async function signInWithEmailPassword(input: SignInRequest): Promise<void> {
  const auth = getFirebaseAuth();
  await signInWithEmailAndPassword(auth, input.email.trim().toLowerCase(), input.password);
}
