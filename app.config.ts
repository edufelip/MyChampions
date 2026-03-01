import type { ExpoConfig, ConfigContext } from 'expo/config';

type AppVariant = 'dev' | 'prod';

type VariantConfig = {
  name: string;
  iosBundleId: string;
  androidPackage: string;
  firebase: {
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
};

const VARIANT_CONFIG: Record<AppVariant, VariantConfig> = {
  dev: {
    name: 'my-champions-dev',
    iosBundleId: 'com.edufelip.mychampions.dev',
    androidPackage: 'com.edufelip.mychampions.dev',
    firebase: {
      apiKey: 'AIzaSyBJOd7In-eY4_3v0aPPttp2tW7Q6r7GysI',
      authDomain: 'mychampions-fb928.firebaseapp.com',
      projectId: 'mychampions-fb928',
      storageBucket: 'mychampions-fb928.firebasestorage.app',
      messagingSenderId: '942354515358',
      appId: '1:942354515358:android:b6a797dedb042d3ee6428f',
      iosClientId: '942354515358-fursf2upkr1ggp1tfhojo1uhiqmtsc2t.apps.googleusercontent.com',
      androidClientId: '942354515358-ldkltehi2l9d942219l68rlbjav7d9mc.apps.googleusercontent.com',
      webClientId: '942354515358-ldkltehi2l9d942219l68rlbjav7d9mc.apps.googleusercontent.com',
      iosAppId: '1:942354515358:ios:f2809afd8d187c7ee6428f',
      androidAppId: '1:942354515358:android:b6a797dedb042d3ee6428f',
    },
  },
  prod: {
    name: 'my-champions',
    iosBundleId: 'com.edufelip.mychampions',
    androidPackage: 'com.edufelip.mychampions',
    firebase: {
      apiKey: 'AIzaSyBJOd7In-eY4_3v0aPPttp2tW7Q6r7GysI',
      authDomain: 'mychampions-fb928.firebaseapp.com',
      projectId: 'mychampions-fb928',
      storageBucket: 'mychampions-fb928.firebasestorage.app',
      messagingSenderId: '942354515358',
      appId: '1:942354515358:android:589e71dbec2da54fe6428f',
      iosClientId: '942354515358-6pqkvvhajja4uon9igq3rtcp2q3k9qvo.apps.googleusercontent.com',
      androidClientId: '942354515358-ldkltehi2l9d942219l68rlbjav7d9mc.apps.googleusercontent.com',
      webClientId: '942354515358-ldkltehi2l9d942219l68rlbjav7d9mc.apps.googleusercontent.com',
      iosAppId: '1:942354515358:ios:7e79b38901952c7ee6428f',
      androidAppId: '1:942354515358:android:589e71dbec2da54fe6428f',
    },
  },
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = (process.env.APP_VARIANT === 'prod' ? 'prod' : 'dev') as AppVariant;
  const selected = VARIANT_CONFIG[variant];

  return {
    ...config,
    name: selected.name,
    slug: 'my-champions',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'mychampions',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: selected.iosBundleId,
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
      package: selected.androidPackage,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-apple-authentication',
      'expo-router',
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
      firebase: selected.firebase,
      dataConnect: {
        graphqlEndpoint: process.env.EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT ?? '',
        apiKey: process.env.EXPO_PUBLIC_DATA_CONNECT_API_KEY ?? '',
      },
    },
  };
};
