import type { ConfigContext, ExpoConfig } from 'expo/config';

type AppVariant = 'dev' | 'prod';

type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  iosClientId: string;
  androidClientId: string;
  webClientId: string;
  iosAppId: string;
  androidAppId: string;
};

type VariantConfig = {
  name: string;
  iosBundleId: string;
  androidPackage: string;
  firebase: FirebaseConfig;
};

type TermsConfig = {
  requiredVersion: string;
  url: string;
};

type RevenueCatConfig = {
  revenueCatApiKeyIos: string;
  revenueCatApiKeyAndroid: string;
};

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}.\nCopy .env.example to .env and fill in all values.`
    );
  }
  return value;
}

function resolveFirebaseConfig(prefix: 'FIREBASE_DEV' | 'FIREBASE_PROD'): FirebaseConfig {
  return {
    apiKey: requireEnv(`${prefix}_API_KEY`),
    authDomain: requireEnv(`${prefix}_AUTH_DOMAIN`),
    projectId: requireEnv(`${prefix}_PROJECT_ID`),
    storageBucket: requireEnv(`${prefix}_STORAGE_BUCKET`),
    messagingSenderId: requireEnv(`${prefix}_MESSAGING_SENDER_ID`),
    appId: requireEnv(`${prefix}_APP_ID`),
    iosClientId: requireEnv(`${prefix}_IOS_CLIENT_ID`),
    androidClientId: requireEnv(`${prefix}_ANDROID_CLIENT_ID`),
    webClientId: requireEnv(`${prefix}_WEB_CLIENT_ID`),
    iosAppId: requireEnv(`${prefix}_IOS_APP_ID`),
    androidAppId: requireEnv(`${prefix}_ANDROID_APP_ID`),
  };
}

function resolveTermsConfig(): TermsConfig {
  const requiredVersion = process.env.EXPO_PUBLIC_TERMS_REQUIRED_VERSION?.trim() || 'v1';
  const url = process.env.EXPO_PUBLIC_TERMS_URL?.trim() || 'https://google.com';

  return {
    requiredVersion,
    url,
  };
}

function resolveRevenueCatConfig(variant: AppVariant): RevenueCatConfig {
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
  };
}

const VARIANT_IDENTIFIERS: Record<AppVariant, Omit<VariantConfig, 'firebase' | 'dataConnect'>> = {
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
  const prefix = variant === 'prod' ? 'FIREBASE_PROD' : 'FIREBASE_DEV';
  const { name, iosBundleId, androidPackage } = VARIANT_IDENTIFIERS[variant];
  const firebase = resolveFirebaseConfig(prefix);
  const terms = resolveTermsConfig();
  const revenueCat = resolveRevenueCatConfig(variant);

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
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: androidPackage,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-apple-authentication',
      'expo-router',
      'expo-localization',
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
          backgroundColor: '#ffffff',
          dark: {
            backgroundColor: '#000000',
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
      firebase,
      terms,
      // RevenueCat SDK API keys — read by subscription-source.ts via Constants.expoConfig.extra.
      // Must be public SDK keys (appl_*/goog_*), never secret keys (sk_*).
      // Variant-aware keys:
      //  - APP_VARIANT=dev  -> EXPO_PUBLIC_REVENUECAT_API_KEY_*_DEV
      //  - APP_VARIANT=prod -> EXPO_PUBLIC_REVENUECAT_API_KEY_*_PROD
      // Legacy fallback retained temporarily: EXPO_PUBLIC_REVENUECAT_API_KEY_IOS/ANDROID.
      revenueCatApiKeyIos: revenueCat.revenueCatApiKeyIos,
      revenueCatApiKeyAndroid: revenueCat.revenueCatApiKeyAndroid,
    },
  };
};
