import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { enUS } from '@/localization/en-US';

type ManifestSuite = {
  runner: string;
  ci: boolean;
  platforms?: string[];
  specs: string[];
};

type TestImpactManifest = {
  suites: Record<string, ManifestSuite>;
};

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, 'config/test-impact.json'), 'utf8'),
) as TestImpactManifest;

function flows(folder: string): { name: string; source: string }[] {
  const directory = join(root, folder);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.yaml') && name !== 'config.yaml')
    .map((name) => ({ name, source: readFileSync(join(directory, name), 'utf8') }));
}

function tagged(folder: string, tag: string): { name: string; source: string }[] {
  return flows(folder).filter(({ source }) =>
    new RegExp(`^tags: \\[(.*, )?${tag}(, .*)?\\]$`, 'm').test(source),
  );
}

const ciFlowFolders = [
  ...new Set(
    Object.values(manifest.suites)
      .filter((suite) => suite.runner === 'maestro' && suite.ci)
      .flatMap((suite) => suite.specs),
  ),
];

test('every CI Maestro flow starts from a shared fresh-launch entry', () => {
  assert.ok(ciFlowFolders.length > 0);
  for (const folder of ciFlowFolders) {
    for (const { name, source } of flows(folder)) {
      const firstCommand = source
        .split('\n---\n')[1]
        ?.split('\n')
        .find((line) => line.startsWith('- '));
      assert.match(firstCommand ?? '', /^- runFlow:/, `${folder}/${name}`);
      assert.doesNotMatch(source, /^- launchApp/m, `${folder}/${name} launches the app directly`);
    }
  }
  const launchFresh = readFileSync(join(root, '.maestro/suite/common/launch-fresh.yaml'), 'utf8');
  assert.match(launchFresh, /clearState: true/);
});

test('student dashboard stories launch a fresh app per case', () => {
  const professionalsEntry = readFileSync(
    join(root, '.maestro/suite/common/student-professionals.yaml'),
    'utf8',
  );
  assert.match(
    professionalsEntry,
    /file: launch-fresh\.yaml\n    env:\n      CAMERA_PERMISSION: allow/,
  );
  for (const { name, source } of flows('.maestro/suite/student-professionals')) {
    assert.match(source, /^- runFlow: \.\.\/common\/student-professionals\.yaml$/m, name);
  }
  for (const { name, source } of flows('.maestro/suite/student-home')) {
    assert.match(source, /^- runFlow: \.\.\/common\/launch-fresh\.yaml$/m, name);
  }
});

test('AI meal analysis executes only the fixture phase matching its scenario', () => {
  const folder = '.maestro/suite/custom-meal-ai-analysis';
  assert.deepEqual(
    tagged(folder, 'meal-analysis-paywall').map(({ source }) => /name: (.*)/.exec(source)?.[1]),
    ['Custom meal AI analysis - shows the premium AI analysis gate before capture is available'],
  );
  assert.deepEqual(
    tagged(folder, 'meal-analysis-success').map(({ source }) => /name: (.*)/.exec(source)?.[1]),
    [
      'Custom meal AI analysis - analyzes a selected meal photo through the dev fixture and pre-fills macros',
    ],
  );
  assert.equal(flows(folder).length, 2);
});

test('custom meal image upload executes only the fixture phase matching its scenario', () => {
  const folder = '.maestro/suite/custom-meal-image-upload';
  for (const tag of [
    'image-upload-sheet',
    'image-upload-success',
    'image-upload-permission-denied',
  ]) {
    assert.equal(tagged(folder, tag).length, 1, tag);
  }
  assert.equal(flows(folder).length, 3);
  const [denied] = tagged(folder, 'image-upload-permission-denied');
  // Android reports the fixture's denial straight from the picker; iOS first
  // shows the source sheet, so only iOS taps "Take photo".
  assert.match(
    denied.source,
    /- runFlow:\n    when:\n      platform: iOS\n    commands:[\s\S]*?text: Take photo/,
  );
  assert.match(denied.source, /CAMERA_PERMISSION: deny/);
  const imageUploadHookSource = readFileSync(
    join(root, 'features/nutrition/use-image-upload.ts'),
    'utf8',
  );
  assert.match(
    imageUploadHookSource,
    /fixture === 'permission-denied' && Platform\.OS === 'android'/,
  );
  assert.equal(enUS['photo_picker.title'], 'Upload image');
  assert.match(tagged(folder, 'image-upload-sheet')[0].source, /text: Upload image/);
});

test('native gap phases remain scenario-isolated', () => {
  const fixtureSource = readFileSync(join(root, 'scripts/ci/native-fixture-profiles.ts'), 'utf8');

  assert.deepEqual(
    tagged('.maestro/suite/auth-role-selection', 'role-persistence').map(({ name }) => name),
    ['06-role-persists-after-relaunch.yaml'],
  );
  assert.match(
    readFileSync(join(root, 'features/auth/e2e-auth-session.ts'), 'utf8'),
    /EXPO_PUBLIC_E2E_ROLE_PERSISTENCE/,
  );
  const [invalidQr] = tagged('.maestro/suite/student-professionals', 'qr-invalid-payload');
  assert.match(invalidQr.source, /student\.professionals\.qrScanError/);
  assert.equal(tagged('.maestro/suite/student-professionals', 'qr-invalid-payload').length, 1);
  assert.match(fixtureSource, /'auth-role-persistence'/);
  assert.match(fixtureSource, /id: 'image-upload-permission-denied'/);
  assert.match(fixtureSource, /EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD: 'NUT123'/);
  assert.match(fixtureSource, /id: 'qr-invalid-payload'/);
});

test('custom meal quick logging preserves grams and dismisses each native keyboard explicitly', () => {
  const source = readFileSync(
    join(root, '.maestro/suite/custom-meal-library/02-quick-log.yaml'),
    'utf8',
  );

  assert.match(
    source,
    /- tapOn:\n    id: meal\.library\.quickLog\.input\n- inputText: "150"\n- assertVisible:\n    id: meal\.library\.quickLog\.input\n    text: "150"\n- runFlow:\n    file: \.\.\/common\/dismiss-keyboard\.yaml\n    env:\n      KEYBOARD_DONE_ID: meal\.library\.quickLog\.keyboard\.done/,
  );
  assert.match(
    source,
    /- extendedWaitUntil:\n    notVisible:\n      id: meal\.library\.quickLog\.panel\n    timeout: 10000/,
  );
  assert.doesNotMatch(source, /point:/);
});
