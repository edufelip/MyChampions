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

const VARIANT_IDENTIFIERS: Record<AppVariant, Omit<VariantConfig, 'firebase'>> = {
  dev: {
    name: 'my-champions-dev',
    iosBundleId: 'com.edufelip.mychampions.dev',
    androidPackage: 'com.edufelip.mychampions.dev',
  },
  prod: {
    name: 'my-champions',
    iosBundleId: 'com.edufelip.mychampions',
    androidPackage: 'com.edufelip.mychampions',
  },
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = (process.env.APP_VARIANT === 'prod' ? 'prod' : 'dev') as AppVariant;
  const prefix = variant === 'prod' ? 'FIREBASE_PROD' : 'FIREBASE_DEV';
  const { name, iosBundleId, androidPackage } = VARIANT_IDENTIFIERS[variant];
  const firebase = resolveFirebaseConfig(prefix);

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
        NSCameraUsageDescription:
          'My Champions uses the camera to scan QR invite codes from your professional.',
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
      [
        'expo-camera',
        {
          cameraPermission:
            'My Champions uses the camera to scan QR invite codes from your professional.',
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
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
      dataConnect: {
        graphqlEndpoint: process.env.EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT ?? '',
        apiKey: process.env.EXPO_PUBLIC_DATA_CONNECT_API_KEY ?? '',
      },
    },
  };
};
