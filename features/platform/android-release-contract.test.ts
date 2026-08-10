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
  assert.match(buildGradle, /productionReleaseInGraph/);
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

  const releaseBuildType = buildGradle.slice(buildGradle.indexOf('    buildTypes {'));
  assert.doesNotMatch(
    releaseBuildType,
    /release \{[\s\S]*?signingConfig signingConfigs\.debug/,
    'release build type must never fall back to the Android debug certificate',
  );

  assert.match(workflow, /cat <<EOF > keystore\.properties/);
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
  assert.equal(
    packageJson.scripts['test:e2e:build:android'],
    'detox build -c android.emu.prodDebug',
    'the default local Detox build must not require private release signing inputs',
  );
  assert.equal(
    packageJson.scripts['test:e2e:build:android:release'],
    'detox build -c android.emu.release',
    'signed release Detox evidence must remain available only through an explicit command',
  );
  const detoxConfig = readFileSync(join(root, '.detoxrc.js'), 'utf8');
  assert.match(
    detoxConfig,
    /-PCI_VERSION_CODE="\\?\$\{CI_VERSION_CODE:\?CI_VERSION_CODE_required\}"/,
    'the explicit signed Detox build must forward an explicit version code to Gradle',
  );
  assert.match(gitignore, /^android\/keystore\.properties$/m);
  assert.match(gitignore, /^\*\.jks$/m);
});
