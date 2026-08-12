import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// app/shared/webview.tsx is the native (iOS/Android) in-app WebView screen. It reads `url`
// from the route's search params, so it is reachable via the app's own deep-link scheme
// (mychampions://shared/webview?url=<attacker-controlled>). `resolveSafeExternalUrl()` rejects
// non-https, javascript:/data:/file:, and credentials-embedded URLs before either native sink;
// this test locks the native screen to that contract and its recoverable invalid-link state.
const webviewSource = readFileSync(join(process.cwd(), 'app/shared/webview.tsx'), 'utf8');
const webviewWebSource = readFileSync(join(process.cwd(), 'app/shared/webview.web.tsx'), 'utf8');

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

  // Asserting only the absence of the raw `url` at each sink leaves room for a
  // future alias or fallback (e.g. `safeUrl ?? url`) to reintroduce it without
  // failing either check above. Pin the exact validated expression at both
  // sinks and require a visible back affordance when validation fails.
  assert.match(
    webviewSource,
    /if\s*\(!safeUrl\)\s*\{[\s\S]*router\.back\(\)[\s\S]*testID="shared\.webview\.invalidLink\.backButton"/s,
    'expected a recoverable invalid-link state with a back action',
  );
  assert.match(
    webviewSource,
    /Linking\.openURL\(safeUrl\)/,
    'Linking.openURL must call the sanitized safeUrl exactly, not an alias or fallback',
  );
  assert.match(
    webviewSource,
    /source=\{\{\s*uri:\s*safeUrl\s*\}\}/,
    'WebView source must use the sanitized safeUrl exactly, not an alias or fallback',
  );
});

test('web webview screen offers recovery when the legal url is invalid', () => {
  assert.match(
    webviewWebSource,
    /resolveSafeExternalUrl\(\s*url/,
    'expected the web screen to validate the raw `url` route param before rendering link actions',
  );
  assert.match(
    webviewWebSource,
    /router\.back\(\)[\s\S]*testID="shared\.webview\.invalidLink\.backButton"/s,
    'expected the web invalid-link state to provide a recoverable back action',
  );
});
