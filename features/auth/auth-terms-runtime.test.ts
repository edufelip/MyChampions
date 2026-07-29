import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const authTermsE2ESource = readFileSync(
  join(process.cwd(), 'e2e/auth-terms.e2e.test.js'),
  'utf8'
);

test('auth terms launches one fresh native app instance per case', () => {
  assert.match(
    authTermsE2ESource,
    /beforeEach\(async \(\) => \{\s+await device\.launchApp\(\{\s+newInstance: true,\s+launchArgs: \{ detoxEnableSynchronization: 0 \},\s+\}\);\s+\}\);/
  );
  assert.doesNotMatch(authTermsE2ESource, /reloadReactNative/);
  assert.doesNotMatch(authTermsE2ESource, /disableSynchronization/);
  assert.equal(
    authTermsE2ESource.match(/device\.launchApp/g)?.length,
    1
  );
});
