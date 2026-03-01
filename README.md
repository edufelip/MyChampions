# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Firebase auth config

Auth flow (email/password, Google, Apple) is wired to Firebase Auth and reads keys from `app.json`:

```json
{
  "expo": {
    "extra": {
      "firebase": {
        "apiKey": "...",
        "authDomain": "...",
        "projectId": "...",
        "storageBucket": "...",
        "messagingSenderId": "...",
        "appId": "...",
        "iosClientId": "...",
        "androidClientId": "...",
        "webClientId": "..."
      }
    }
  }
}
```

Replace all `REPLACE_ME` values before testing auth providers.

## Testing

1. Unit tests

   ```bash
   npm run test:unit
   ```

2. E2E (Detox) iOS

   ```bash
   npm run test:e2e:build:ios
   npm run test:e2e:ios
   ```

3. E2E (Detox) Android

   ```bash
   npm run test:e2e:build:android
   npm run test:e2e:android
   ```

4. E2E debug variants (optional)

   ```bash
   npm run test:e2e:build:ios:debug
   npm run test:e2e:ios:debug
   npm run test:e2e:build:android:debug
   npm run test:e2e:android:debug
   ```

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
