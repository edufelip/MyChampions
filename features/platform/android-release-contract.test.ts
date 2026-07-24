import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');

test('production Android releases fail closed onto CI versioning and private release signing', () => {
  const buildGradle = readFileSync(join(root, 'android', 'app', 'build.gradle'), 'utf8');
  const workflow = readFileSync(join(root, '.github', 'workflows', 'android-release.yml'), 'utf8');
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');

  assert.match(buildGradle, /gradle\.taskGraph\.whenReady/);
  assert.match(buildGradle, /productionReleaseInGraph/);
  assert.match(buildGradle, /rootProject\.file\("keystore\.properties"\)/);
  assert.match(
    buildGradle,
    /requiredReleaseSigningProperties = \["storeFile", "storePassword", "keyAlias", "keyPassword"\]/,
  );
  assert.match(buildGradle, /rootProject\.file\(releaseKeystoreProperties\.getProperty\("storeFile"\)\.trim\(\)\)/);
  assert.match(buildGradle, /providers\.gradleProperty\("CI_VERSION_CODE"\)/);
  assert.match(buildGradle, /candidateVersionCode <= 2100000000L/);
  assert.match(buildGradle, /CI_VERSION_CODE from 1 through 2100000000/);
  assert.match(buildGradle, /versionCode resolvedVersionCode/);
  assert.match(buildGradle, /signingConfig signingConfigs\.release/);
  assert.match(buildGradle, /debug signing is never used/);

  const releaseBuildType = buildGradle.slice(buildGradle.indexOf('    buildTypes {'));
  assert.doesNotMatch(
    releaseBuildType,
    /release \{[\s\S]*?signingConfig signingConfigs\.debug/,
    'release build type must never fall back to the Android debug certificate',
  );

  assert.match(workflow, /cat <<EOF > keystore\.properties/);
  assert.match(
    workflow,
    /- name: Decode keystore[\s\S]*?working-directory: android/,
  );
  assert.match(
    workflow,
    /- name: Create keystore\.properties[\s\S]*?working-directory: android/,
  );
  assert.match(workflow, /-PCI_VERSION_CODE=\$\{\{ env\.CI_VERSION_CODE \}\}/);
  assert.match(workflow, /bundleProductionRelease/);
  assert.match(workflow, /track: internal/);
  assert.match(workflow, /status: draft/);
  assert.match(gitignore, /^android\/keystore\.properties$/m);
  assert.match(gitignore, /^\*\.jks$/m);
});
