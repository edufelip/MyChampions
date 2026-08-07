import type { ConfigContext, ExpoConfig } from 'expo/config';

const DEFAULT_TERMS_URL = 'https://portfolio.eduwaldo.com/projects/my-champions/terms_of_use';
const DEFAULT_PRIVACY_POLICY_URL = 'https://portfolio.eduwaldo.com/projects/my-champions/privacy_policy';

type AppVariant = 'dev' | 'prod';

type VariantConfig = {
  name: string;
  iosBundleId: string;
  androidPackage: string;
};

type TermsConfig = {
  requiredVersion: string;
  url: string;
  privacyPolicyUrl: string;
};

type RevenueCatConfig = {
  revenueCatApiKeyIos: string;
  revenueCatApiKeyAndroid: string;
  revenueCatTestStoreEnabled: boolean;
  revenueCatStudentOfferingId: 'default_student' | 'test_student';
  revenueCatProfessionalOfferingId: 'default_professional' | 'test_professional';
};

type ServerConfig = {
  baseUrl: string;
};

type GoogleAuthConfig = {
  androidClientId: string;
  iosClientId: string;
  webClientId: string;
};

type AppleWebAuthConfig = {
  clientId: string;
  redirectUri: string;
};

type E2EConfig = {
  acceptedTermsVersion: string;
  authSession: string;
  createAccount: string;
  emailPasswordSignIn: string;
  socialAuth: string;
};

function resolveTermsConfig(): TermsConfig {
  const requiredVersion = process.env.EXPO_PUBLIC_TERMS_REQUIRED_VERSION?.trim() || 'v1';
  const url = process.env.EXPO_PUBLIC_TERMS_URL?.trim() || DEFAULT_TERMS_URL;
  const privacyPolicyUrl =
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() || DEFAULT_PRIVACY_POLICY_URL;

  return {
    requiredVersion,
    url,
    privacyPolicyUrl,
  };
}

export function resolveRevenueCatConfig(variant: AppVariant): RevenueCatConfig {
  const revenueCatTestStoreEnabled =
    variant === 'dev' &&
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED?.trim().toLowerCase() === 'true';
  const studentOfferingOverride =
    process.env.EXPO_PUBLIC_REVENUECAT_STUDENT_OFFERING_ID?.trim() ?? '';
  const professionalOfferingOverride =
    process.env.EXPO_PUBLIC_REVENUECAT_PROFESSIONAL_OFFERING_ID?.trim() ?? '';

  if (
    studentOfferingOverride &&
    studentOfferingOverride !== 'default_student' &&
    studentOfferingOverride !== 'test_student'
  ) {
    throw new Error(
      'EXPO_PUBLIC_REVENUECAT_STUDENT_OFFERING_ID must be default_student or test_student.'
    );
  }
  if (
    studentOfferingOverride === 'test_student' &&
    (variant !== 'dev' || !revenueCatTestStoreEnabled)
  ) {
    throw new Error(
      'RevenueCat test_student offering is allowed only in an explicit development Test Store build.'
    );
  }

  if (
    professionalOfferingOverride &&
    professionalOfferingOverride !== 'default_professional' &&
    professionalOfferingOverride !== 'test_professional'
  ) {
    throw new Error(
      'EXPO_PUBLIC_REVENUECAT_PROFESSIONAL_OFFERING_ID must be default_professional or test_professional.'
    );
  }
  if (
    professionalOfferingOverride === 'test_professional' &&
    (variant !== 'dev' || !revenueCatTestStoreEnabled)
  ) {
    throw new Error(
      'RevenueCat test_professional offering is allowed only in an explicit development Test Store build.'
    );
  }

  const revenueCatStudentOfferingId =
    studentOfferingOverride === 'test_student' ? 'test_student' : 'default_student';
  const revenueCatProfessionalOfferingId =
    professionalOfferingOverride === 'test_professional'
      ? 'test_professional'
      : 'default_professional';
  const testStoreKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE?.trim() ?? '';
  if (revenueCatTestStoreEnabled) {
    return {
      revenueCatApiKeyIos: testStoreKey,
      revenueCatApiKeyAndroid: testStoreKey,
      revenueCatTestStoreEnabled: true,
      revenueCatStudentOfferingId,
      revenueCatProfessionalOfferingId,
    };
  }

  const iosVariantKey =
    variant === 'prod'
      ? process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_PROD
      : process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_DEV;
  const androidVariantKey =
    variant === 'prod'
      ? process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_PROD
      : process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_DEV;

  // Backward-compatible fallback for existing CI/local setups.
  const legacyIosKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
  const legacyAndroidKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;

  return {
    revenueCatApiKeyIos: iosVariantKey ?? legacyIosKey ?? '',
    revenueCatApiKeyAndroid: androidVariantKey ?? legacyAndroidKey ?? '',
    revenueCatTestStoreEnabled: false,
    revenueCatStudentOfferingId,
    revenueCatProfessionalOfferingId,
  };
}

function resolveServerConfig(): ServerConfig {
  return {
    baseUrl: process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL?.trim() ?? '',
  };
}

function resolveGoogleAuthConfig(): GoogleAuthConfig {
  return {
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID?.trim() ?? '',
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID?.trim() ?? '',
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID?.trim() ?? '',
  };
}

function resolveAppleWebAuthConfig(): AppleWebAuthConfig {
  return {
    clientId: process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID?.trim() ?? '',
    redirectUri: process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI?.trim() ?? '',
  };
}

function resolveE2EConfig(variant: AppVariant): E2EConfig {
  return {
    acceptedTermsVersion: variant === 'dev' ? process.env.EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION?.trim() ?? '' : '',
    authSession: variant === 'dev' ? process.env.EXPO_PUBLIC_E2E_AUTH_SESSION?.trim() ?? '' : '',
    createAccount: variant === 'dev' ? process.env.EXPO_PUBLIC_E2E_CREATE_ACCOUNT?.trim() ?? '' : '',
    emailPasswordSignIn: variant === 'dev' ? process.env.EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN?.trim() ?? '' : '',
    socialAuth: variant === 'dev' ? process.env.EXPO_PUBLIC_E2E_SOCIAL_AUTH?.trim() ?? '' : '',
  };
}

const VARIANT_IDENTIFIERS: Record<AppVariant, VariantConfig> = {
  dev: {
    name: 'MyChampions Dev',
    iosBundleId: 'com.edufelip.mychampions.dev',
    androidPackage: 'com.edufelip.mychampions.dev',
  },
  prod: {
    name: 'MyChampions',
    iosBundleId: 'com.edufelip.mychampions',
    androidPackage: 'com.edufelip.mychampions',
  },
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = (process.env.APP_VARIANT === 'prod' ? 'prod' : 'dev') as AppVariant;
  const { name, iosBundleId, androidPackage } = VARIANT_IDENTIFIERS[variant];
  const terms = resolveTermsConfig();
  const revenueCat = resolveRevenueCatConfig(variant);
  const server = resolveServerConfig();
  const googleAuth = resolveGoogleAuthConfig();
  const appleWebAuth = resolveAppleWebAuthConfig();
  const e2e = resolveE2EConfig(variant);

  return {
    ...config,
    name,
    slug: 'my-champions',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'mychampions',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: iosBundleId,
      infoPlist: {
        // Permission strings are applied directly to ios/mychampions/Info.plist
        // (no expo prebuild policy — D-129). Kept here as documentation only;
        // Expo SDK does not read these when plugins are omitted.
        // NSCameraUsageDescription: see Info.plist
        // NSPhotoLibraryUsageDescription: see Info.plist
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#E2FAE8',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: androidPackage,
    },
    web: {
      output: 'single',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-apple-authentication',
      'expo-router',
      'expo-localization',
      'expo-video',
      // expo-camera and expo-image-picker native permissions are applied directly
      // to ios/mychampions/Info.plist and android/app/src/main/AndroidManifest.xml.
      // Plugin entries are omitted here because native dirs are maintained manually
      // (no expo prebuild policy — D-129).
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#E2FAE8',
          dark: {
            backgroundColor: '#E2FAE8',
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      appVariant: variant,
      server,
      terms,
      // RevenueCat SDK API keys — read by subscription-source.ts via Constants.expoConfig.extra.
      // Must be public SDK keys (appl_*/goog_*), never secret keys (sk_*).
      // Explicit dev-only Test Store builds use the project test_* SDK key for both platforms.
      // Variant-aware keys:
      //  - APP_VARIANT=dev  -> EXPO_PUBLIC_REVENUECAT_API_KEY_*_DEV
      //  - APP_VARIANT=prod -> EXPO_PUBLIC_REVENUECAT_API_KEY_*_PROD
      // Legacy fallback retained temporarily: EXPO_PUBLIC_REVENUECAT_API_KEY_IOS/ANDROID.
      revenueCatApiKeyIos: revenueCat.revenueCatApiKeyIos,
      revenueCatApiKeyAndroid: revenueCat.revenueCatApiKeyAndroid,
      revenueCatTestStoreEnabled: revenueCat.revenueCatTestStoreEnabled,
      // Defaults to default_student. test_student is accepted only for explicit dev Test Store builds.
      revenueCatStudentOfferingId: revenueCat.revenueCatStudentOfferingId,
      // Defaults to default_professional. test_professional is accepted only for explicit dev Test Store builds.
      revenueCatProfessionalOfferingId: revenueCat.revenueCatProfessionalOfferingId,
      googleAuth,
      appleWebAuth,
      subscriptionHandoffUrl:
        process.env.EXPO_PUBLIC_SUBSCRIPTION_HANDOFF_URL?.trim() ?? '',
      e2e,
    },
  };
};
