import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');

test('production Android releases fail closed onto CI versioning and private release signing', () => {
  const buildGradle = readFileSync(join(root, 'android', 'app', 'build.gradle'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const workflow = readFileSync(join(root, '.github', 'workflows', 'android-release.yml'), 'utf8');
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');

  assert.match(buildGradle, /gradle\.taskGraph\.whenReady/);
  assert.match(buildGradle, /productionReleaseRequested/);
  assert.match(buildGradle, /rootProject\.file\("keystore\.properties"\)/);
  assert.match(
    buildGradle,
    /requiredReleaseSigningProperties = \["storeFile", "storePassword", "keyAlias", "keyPassword"\]/,
  );
  assert.match(
    buildGradle,
    /rootProject\.file\(releaseKeystoreProperties\.getProperty\("storeFile"\)\.trim\(\)\)/,
  );
  assert.match(buildGradle, /providers\.gradleProperty\("CI_VERSION_CODE"\)/);
  assert.match(buildGradle, /candidateVersionCode <= 2100000000L/);
  assert.match(buildGradle, /CI_VERSION_CODE from 1 through 2100000000/);
  assert.match(buildGradle, /versionCode resolvedVersionCode/);
  assert.match(buildGradle, /signingConfig signingConfigs\.release/);
  assert.match(buildGradle, /debug signing is never used/);
  assert.match(buildGradle, /devReleaseWithDebugSigning/);
  assert.match(buildGradle, /devReleaseRequested/);
  assert.match(buildGradle, /productionReleaseRequested/);
  assert.match(
    buildGradle,
    /devReleaseWithDebugSigning && devReleaseRequested && !productionReleaseRequested/,
    'debug signing is permitted only for the explicit development distribution task',
  );

  assert.match(
    buildGradle,
    /Production release requires android\/keystore\.properties; debug signing is never used\./,
    'production releases must remain fail-closed on the private signing key',
  );

  const releaseBuildType = buildGradle.slice(buildGradle.indexOf('    buildTypes {'));
  assert.doesNotMatch(
    releaseBuildType,
    /release \{\s*signingConfig signingConfigs\.debug/,
    'release build type must not unconditionally fall back to the Android debug certificate',
  );

  assert.match(workflow, /cat <<EOF > keystore\.properties/);
  assert.match(
    workflow,
    /runs-on: \[self-hosted, Linux, X64, mychampions-ci, mychampions-android\]/,
    'credentialed Android release builds must use the repository Linux runner',
  );
  assert.match(workflow, /- name: Decode keystore[\s\S]*?working-directory: android/);
  assert.match(workflow, /- name: Create keystore\.properties[\s\S]*?working-directory: android/);
  assert.match(workflow, /-PCI_VERSION_CODE=\$\{\{ env\.CI_VERSION_CODE \}\}/);
  assert.match(workflow, /bundleProductionRelease/);
  assert.match(workflow, /track: internal/);
  assert.match(workflow, /status: draft/);
  for (const scriptName of ['android:release', 'android:release:device']) {
    assert.match(
      packageJson.scripts[scriptName],
      /-PCI_VERSION_CODE=\$\{CI_VERSION_CODE:\?CI_VERSION_CODE_required\}/,
      `${scriptName} must forward an explicit positive version code to the Gradle guard`,
    );
  }
  assert.match(
    packageJson.scripts['test:e2e:build:android:debug'],
    /\.\/gradlew app:assembleDevDebug /,
    'the local native E2E build must stay on the debug variant, which needs no release signing inputs',
  );
  assert.doesNotMatch(
    packageJson.scripts['test:e2e:build:android:debug'],
    /Release|CI_VERSION_CODE/,
    'the local native E2E build must not require private release signing inputs',
  );
  assert.match(gitignore, /^android\/keystore\.properties$/m);
  assert.match(gitignore, /^\*\.jks$/m);
});
