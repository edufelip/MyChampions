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
import { createUserWithEmailAndPassword, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';

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

export default function CreateAccountScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const router = useRouter();
  const { t } = useTranslation();
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

  const onCreateAccount = async () => {
    const nextErrors = validateCreateAccountInput({ name, email, password, passwordConfirmation });
    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      await createAccountWithEmailPassword({ name, email, password, passwordConfirmation });
      router.replace('/auth/role-selection');
    } catch (error: unknown) {
      const reason = normalizeCreateAccountReason(error);
      setSubmitError(mapCreateAccountReasonToMessageKey(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleCreateAccount = async () => {
    setSubmitError(null);

    try {
      await promptGoogle();
    } catch (error: unknown) {
      const reason = normalizeCreateAccountReason(error);
      setSubmitError(mapCreateAccountReasonToMessageKey(reason));
    }
  };

  const onAppleCreateAccount = async () => {
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

      const reason = normalizeCreateAccountReason(error);
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
      setSubmitError('common.error.generic');
      return;
    }

    setSubmitting(true);
    void signInOrLinkWithCredential(GoogleAuthProvider.credential(idToken))
      .then(() => {
        router.replace('/auth/role-selection');
      })
      .catch((error: unknown) => {
        const reason = normalizeCreateAccountReason(error);
        setSubmitError(mapCreateAccountReasonToMessageKey(reason));
      })
      .finally(() => {
        setSubmitting(false);
      });
  }, [googleResponse, router]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: palette.background }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      testID="auth.createAccount.screen">
      <Stack.Screen options={{ title: t('auth.signup.title'), headerShown: false }} />

      <View style={styles.content}>
        <Text style={[styles.title, { color: palette.text }]} testID="auth.createAccount.title">
          {t('auth.signup.title')}
        </Text>

        <View style={styles.formSection}>
          <Text style={[styles.fieldLabel, { color: palette.text }]}>{t('auth.field.name')}</Text>
          <TextInput
            accessibilityLabel={t('auth.field.name')}
            autoCapitalize="words"
            autoComplete="name"
            onChangeText={setName}
            placeholder={t('auth.placeholder.name')}
            placeholderTextColor={palette.icon}
            style={[styles.input, { borderColor: palette.icon, color: palette.text }]}
            testID="auth.createAccount.nameInput"
            value={name}
          />
          <View accessibilityLiveRegion="polite">
            {errors.name ? (
              <Text style={styles.inlineError} testID="auth.createAccount.error.nameRequired">
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
            style={[styles.input, { borderColor: palette.icon, color: palette.text }]}
            testID="auth.createAccount.emailInput"
            value={email}
          />
          <View accessibilityLiveRegion="polite">
            {errors.email ? (
              <Text style={styles.inlineError} testID="auth.createAccount.error.emailRequired">
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
              style={[styles.input, styles.passwordInput, { borderColor: palette.icon, color: palette.text }]}
              testID="auth.createAccount.passwordInput"
              value={password}
            />
            <Pressable
              accessibilityLabel={
                showPassword ? t('auth.password.toggle_hide') : t('auth.password.toggle_show')
              }
              accessibilityRole="button"
              onPress={() => setShowPassword((current) => !current)}
              style={[styles.passwordToggle, { borderColor: palette.icon }]}
              testID="auth.createAccount.passwordToggle">
              <Text style={[styles.passwordToggleText, { color: palette.text }]}>
                {showPassword ? t('auth.password.toggle_hide_short') : t('auth.password.toggle_show_short')}
              </Text>
            </Pressable>
          </View>
          <Text style={[styles.helperText, { color: palette.icon }]}>{t('auth.signup.password_helper')}</Text>
          <View accessibilityLiveRegion="polite">
            {errors.password ? (
              <Text style={styles.inlineError} testID="auth.createAccount.error.password">
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
              style={[styles.input, styles.passwordInput, { borderColor: palette.icon, color: palette.text }]}
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
              style={[styles.passwordToggle, { borderColor: palette.icon }]}
              testID="auth.createAccount.passwordConfirmationToggle">
              <Text style={[styles.passwordToggleText, { color: palette.text }]}>
                {showPasswordConfirmation
                  ? t('auth.password.toggle_hide_short')
                  : t('auth.password.toggle_show_short')}
              </Text>
            </Pressable>
          </View>
          <View accessibilityLiveRegion="polite">
            {errors.passwordConfirmation ? (
              <Text style={styles.inlineError} testID="auth.createAccount.error.passwordConfirmation">
                {t(errors.passwordConfirmation)}
              </Text>
            ) : null}
          </View>
        </View>

        <View accessibilityRole="alert">
          {submitError ? (
            <Text style={styles.submitError} testID="auth.createAccount.error.submit">
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
              backgroundColor: palette.tint,
              opacity: submitting ? 0.7 : pressed ? 0.85 : 1,
            },
          ]}
          testID="auth.createAccount.submitButton">
          {submitting ? (
            <ActivityIndicator
              accessibilityLabel={t('a11y.loading.submitting')}
              color={colorScheme === 'dark' ? '#11181C' : '#ffffff'}
            />
          ) : (
            <Text style={styles.primaryButtonText}>{t('auth.signup.cta_primary')}</Text>
          )}
        </Pressable>

        <Text style={[styles.dividerText, { color: palette.icon }]}>{t('auth.signup.or_continue')}</Text>

        <View style={styles.socialRow}>
          <Pressable
            accessibilityRole="button"
            disabled={submitting || !googleRequest}
            onPress={onGoogleCreateAccount}
            style={[styles.socialButton, { borderColor: palette.icon }]}
            testID="auth.createAccount.googleButton">
            <Text style={[styles.socialButtonText, { color: palette.text }]}>{t('auth.social.google')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={onAppleCreateAccount}
            style={[styles.socialButton, { borderColor: palette.icon }]}
            testID="auth.createAccount.appleButton">
            <Text style={[styles.socialButtonText, { color: palette.text }]}>{t('auth.social.apple')}</Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/auth/sign-in')}
          style={styles.secondaryButton}
          testID="auth.createAccount.backToSignInButton">
          <Text style={[styles.secondaryButtonText, { color: palette.tint }]}>
            {t('auth.signup.cta_back_signin')}
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
    fontSize: 15,
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
  helperText: {
    fontSize: 13,
    lineHeight: 18,
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

async function createAccountWithEmailPassword(input: CreateAccountRequest): Promise<void> {
  const auth = getFirebaseAuth();
  await createUserWithEmailAndPassword(auth, input.email.trim().toLowerCase(), input.password);
}
