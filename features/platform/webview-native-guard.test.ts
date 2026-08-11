import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// app/shared/webview.tsx is the native (iOS/Android) in-app WebView screen. It reads `url`
// straight from the route's search params, so it is reachable via the app's own deep-link
// scheme (mychampions://shared/webview?url=<attacker-controlled>). The screen's only historical
// guard was the WebView component's own `originWhitelist` prop, which react-native-webview's
// own issue tracker documents as not reliably blocking the *initial* `source.uri` load on every
// platform/version. `app/shared/webview.web.tsx` already runs every url through
// `resolveSafeExternalUrl()` before using it (rejecting non-https, javascript:/data:/file:, and
// credentials-embedded URLs) — this test locks the native screen to the same contract so nobody
// re-introduces a raw `uri: url` (or `Linking.openURL(url)`) path in the future.
const webviewSource = readFileSync(join(process.cwd(), 'app/shared/webview.tsx'), 'utf8');

test('native webview screen validates the route url with resolveSafeExternalUrl before use', () => {
  assert.match(
    webviewSource,
    /import\s*\{[^}]*resolveSafeExternalUrl[^}]*\}\s*from\s*['"]@\/features\/platform\/external-url['"]/,
    'expected app/shared/webview.tsx to import resolveSafeExternalUrl from @/features/platform/external-url',
  );

  assert.match(
    webviewSource,
    /resolveSafeExternalUrl\(\s*url/,
    'expected the raw `url` route param to be passed through resolveSafeExternalUrl before use',
  );
});

test('native webview screen never feeds the raw route url straight into WebView or Linking', () => {
  assert.doesNotMatch(
    webviewSource,
    /source=\{\{\s*uri:\s*url\s*\}\}/,
    'WebView source must use the sanitized url, not the raw route param `url`',
  );
  assert.doesNotMatch(
    webviewSource,
    /Linking\.openURL\(url\)/,
    'Linking.openURL must use the sanitized url, not the raw route param `url`',
  );
});
