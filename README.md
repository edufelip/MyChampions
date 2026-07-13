# MyChampions Mobile

Expo React Native app for MyChampions.

## Get started

1. Install dependencies

   ```bash
   yarn install
   ```

2. Start the local backend from the workspace root

   ```bash
   cd ..
   bun run local:db:up
   bun run local:dev
   ```

3. Start the mobile app

   ```bash
   yarn start
   ```

For native development builds, use:

```bash
yarn ios:dev
yarn android:dev
```

## Local server config

The mobile app uses the root-level MyChampions server for local auth and app-domain data flows. Mobile runtime code does not require mobile-owned provider project keys, document rules, callable backend functions, or native provider config files.

Copy `.env.example` to `.env` and set:

```bash
EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://localhost:3400
```

iOS Simulator can use `localhost`. Physical devices need this Mac's LAN IP.

Production release workflows require the `ENV_FILE` secret to set:

```bash
EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=https://api.mychampions.eduwaldo.com
```

Both iOS and Android release workflows fail before building when this value is
missing or different, preventing a production bundle from shipping with the
local development endpoint.

## Testing

1. Unit tests

   ```bash
   yarn test:unit
   ```

2. E2E (Detox) iOS

   ```bash
   yarn test:e2e:build:ios
   yarn test:e2e:ios
   ```

3. E2E (Detox) Android

   ```bash
   yarn test:e2e:build:android
   yarn test:e2e:android
   ```

4. E2E debug variants (optional)

   The iOS Debug test commands start Metro on port `8081` when it is not already running, and leave a pre-existing Metro process alone.
   The `test:e2e:ios:debug:smoke` command runs unauthenticated auth-entry and authenticated role/connection checks in separate Debug builds so their fixture states cannot conflict. The authenticated connection mode uses deterministic invite, QR, and active-nutrition fixtures without backend mutation.

   ```bash
   yarn test:e2e:build:ios:debug
   yarn test:e2e:ios:debug
   yarn test:e2e:build:android:debug
   yarn test:e2e:android:debug
   ```

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
