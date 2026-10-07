import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveAndroidCameraPromptSpec } from '../../scripts/testing/native-camera-android-capture-adapter';
import {
  ANDROID_CAMERA_PERMISSION_PROMPT_SELECTOR_IDS,
  buildAndroidCameraPermissionCommands,
  sha256,
} from '../../scripts/testing/native-camera-android-contract';
import {
  buildAndroidCameraPermissionDenyAction,
  qualifyAndroidCameraPrompt,
} from '../../scripts/testing/native-camera-android-observation';
import {
  ANDROID_CAMERA_PROMPT_READINESS_SELECTORS,
  buildAndroidCameraPromptActions,
} from '../../scripts/testing/native-camera-android-producer';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/native-camera-android-prompt-v18.json',
);
const APP_LABEL = 'MyChampions Dev';
const SERIAL = 'emulator-5554';
const API_LEVEL = 35;

function fixtureTree(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
}

function source() {
  return { label: 'prompt' } as never;
}

function derive(tree: unknown, locale = 'en-US') {
  return deriveAndroidCameraPromptSpec({
    source: source(),
    tree,
    serial: SERIAL,
    apiLevel: API_LEVEL,
    locale,
    expectedAppLabel: APP_LABEL,
  });
}

function walk(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  return [row, ...(Array.isArray(row.children) ? row.children.flatMap(walk) : [])];
}

function findResource(tree: unknown, resourceId: string): Record<string, unknown> {
  const row = walk(tree).find(
    (candidate) =>
      candidate.attributes &&
      typeof candidate.attributes === 'object' &&
      (candidate.attributes as Record<string, unknown>)['resource-id'] === resourceId,
  );
  assert(row, `fixture resource is missing: ${resourceId}`);
  return row;
}

function cloneTree(tree: unknown): Record<string, unknown> {
  return structuredClone(tree) as Record<string, unknown>;
}

void test('sanitized canonical Android prompt subtree binds exact resources and rejects QR readiness', () => {
  const tree = fixtureTree();
  const spec = derive(tree);
  const qualification = qualifyAndroidCameraPrompt({
    tree,
    hierarchySha256: createHash('sha256').update(JSON.stringify(tree)).digest('hex'),
    promptRootPath: spec.promptRootPath,
    appId: 'com.edufelip.mychampions.dev',
    appLabel: spec.appLabel,
    expectedLocale: 'en-US',
    systemPackage: spec.systemPackage,
    title: spec.title,
    deny: spec.deny,
  });
  assert.equal(spec.systemPackage, 'com.android.permissioncontroller');
  assert.equal(spec.appLabel, APP_LABEL);
  assert.equal(spec.title.value, 'com.android.permissioncontroller:id/permission_message');
  assert.equal(spec.deny.value, 'com.android.permissioncontroller:id/permission_deny_button');
  assert.equal(qualification.actionability, 'supported-maestro-selector');
  assert.match(buildAndroidCameraPermissionDenyAction(qualification), /permission_deny_button/);
  assert.match(buildAndroidCameraPromptActions(), /student\.professionals\.scanQrButton/);
  assert.equal(
    ANDROID_CAMERA_PROMPT_READINESS_SELECTORS,
    ANDROID_CAMERA_PERMISSION_PROMPT_SELECTOR_IDS,
  );
  assert.deepEqual(
    [...ANDROID_CAMERA_PERMISSION_PROMPT_SELECTOR_IDS],
    [
      '^com\\.(?:android\\.permissioncontroller|google\\.android\\.permissioncontroller):id/permission_message$',
      '^com\\.(?:android\\.permissioncontroller|google\\.android\\.permissioncontroller):id/permission_deny_button$',
    ],
  );
  const [messagePattern, denyPattern] = ANDROID_CAMERA_PERMISSION_PROMPT_SELECTOR_IDS.map(
    (selector) => new RegExp(selector, 'u'),
  );
  assert(messagePattern.test('com.android.permissioncontroller:id/permission_message'));
  assert(messagePattern.test('com.google.android.permissioncontroller:id/permission_message'));
  assert(denyPattern.test('com.android.permissioncontroller:id/permission_deny_button'));
  assert(denyPattern.test('com.google.android.permissioncontroller:id/permission_deny_button'));
  assert(!messagePattern.test('com.android.android.permissioncontroller:id/permission_message'));
  assert(!denyPattern.test('com.android.android.permissioncontroller:id/permission_deny_button'));
  assert(!messagePattern.test('com.example.permissioncontroller:id/permission_message'));
  assert(
    !denyPattern.test('com.google.android.permissioncontroller.evil:id/permission_deny_button'),
  );
  assert(
    !ANDROID_CAMERA_PERMISSION_PROMPT_SELECTOR_IDS.some((selector) => selector.includes('qrModal')),
  );
});

void test('prompt qualification supports the bounded Google PermissionController package', () => {
  const tree = cloneTree(fixtureTree());
  for (const row of walk(tree)) {
    const attributes = row.attributes;
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) continue;
    const record = attributes as Record<string, unknown>;
    if (typeof record['resource-id'] === 'string')
      record['resource-id'] = record['resource-id'].replace(
        /^com\.android\.permissioncontroller:/u,
        'com.google.android.permissioncontroller:',
      );
  }
  const spec = derive(tree);
  assert.equal(spec.systemPackage, 'com.google.android.permissioncontroller');
  assert.equal(spec.title.value, 'com.google.android.permissioncontroller:id/permission_message');
  assert.equal(
    spec.deny.value,
    'com.google.android.permissioncontroller:id/permission_deny_button',
  );
});

void test('localized Android prompt contract is closed for pt-BR and es-ES', () => {
  const localized = [
    ['pt-BR', 'Permitir que o app MyChampions Dev tire fotos e grave vídeos?', 'Não permitir'],
    ['es-ES', '¿Permitir que MyChampions Dev haga fotos y grabe vídeos?', 'No permitir'],
  ] as const;
  for (const [locale, titleText, denyText] of localized) {
    const tree = cloneTree(fixtureTree());
    const title = findResource(tree, 'com.android.permissioncontroller:id/permission_message');
    const deny = findResource(tree, 'com.android.permissioncontroller:id/permission_deny_button');
    (title.attributes as Record<string, unknown>).text = titleText;
    (deny.attributes as Record<string, unknown>).text = denyText;
    const spec = derive(tree, locale);
    assert.equal(spec.appLabel, APP_LABEL);
    assert.equal(spec.locale, locale);
  }
});

void test('prompt producer rejects absent, mixed, foreign, duplicate, and arbitrary controls', () => {
  const absent = cloneTree(fixtureTree());
  for (const row of walk(absent)) {
    const attributes = row.attributes;
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) continue;
    const record = attributes as Record<string, unknown>;
    if (typeof record['resource-id'] === 'string')
      record['resource-id'] = 'com.example.foreign:id/not_permission_control';
  }
  assert.throws(() => derive(absent), /resource is missing|controller|title/iu);

  const mixed = cloneTree(fixtureTree());
  const deny = findResource(mixed, 'com.android.permissioncontroller:id/permission_deny_button');
  ((deny.attributes as Record<string, unknown>)['resource-id'] as string) =
    'com.google.android.permissioncontroller:id/permission_deny_button';
  assert.throws(() => derive(mixed), /mixed|unsupported|subtree/iu);

  const foreign = cloneTree(fixtureTree());
  const title = findResource(foreign, 'com.android.permissioncontroller:id/permission_message');
  ((title.attributes as Record<string, unknown>).text as string) =
    'Allow Foreign App to take pictures and record video?';
  assert.throws(() => derive(foreign), /different app|supported Android contract/iu);

  const duplicate = cloneTree(fixtureTree());
  const originalTitle = findResource(
    duplicate,
    'com.android.permissioncontroller:id/permission_message',
  );
  const controller = findResource(duplicate, 'com.android.permissioncontroller:id/grant_singleton');
  const children = controller.children;
  assert(Array.isArray(children));
  children.push(structuredClone(originalTitle));
  assert.throws(() => derive(duplicate), /missing or ambiguous/iu);

  assert.throws(() => derive(fixtureTree(), 'fr-FR'), /Unsupported Android camera prompt locale/iu);

  const disabled = cloneTree(fixtureTree());
  const disabledDeny = findResource(
    disabled,
    'com.android.permissioncontroller:id/permission_deny_button',
  );
  ((disabledDeny.attributes as Record<string, unknown>).enabled as string) = 'false';
  assert.throws(() => derive(disabled), /visible, enabled, and actionable/iu);

  const arbitrary = cloneTree(fixtureTree());
  const arbitraryTitle = findResource(
    arbitrary,
    'com.android.permissioncontroller:id/permission_message',
  );
  const arbitraryDeny = findResource(
    arbitrary,
    'com.android.permissioncontroller:id/permission_deny_button',
  );
  delete (arbitraryTitle.attributes as Record<string, unknown>)['resource-id'];
  delete (arbitraryDeny.attributes as Record<string, unknown>)['resource-id'];
  assert.throws(() => derive(arbitrary), /resource is missing or ambiguous/iu);
});

void test('qualification rechecks exact resource IDs, app label, locale, and actionability', () => {
  const tree = fixtureTree();
  const spec = derive(tree);
  const hierarchySha256 = sha256(JSON.stringify(tree));
  const qualificationInput = {
    tree,
    hierarchySha256,
    promptRootPath: spec.promptRootPath,
    appId: 'com.edufelip.mychampions.dev',
    appLabel: APP_LABEL,
    expectedLocale: 'en-US' as const,
    systemPackage: spec.systemPackage,
    title: spec.title,
    deny: spec.deny,
  };
  assert.doesNotThrow(() => qualifyAndroidCameraPrompt(qualificationInput));
  assert.throws(
    () => qualifyAndroidCameraPrompt({ ...qualificationInput, appLabel: 'Foreign App' }),
    /build-bound label/iu,
  );
  assert.throws(
    () =>
      qualifyAndroidCameraPrompt({
        ...qualificationInput,
        deny: { ...spec.deny, value: 'com.android.permissioncontroller:id/not_deny' },
      }),
    /permission_deny_button|assertion/iu,
  );
  const hidden = cloneTree(tree);
  const hiddenDeny = findResource(
    hidden,
    'com.android.permissioncontroller:id/permission_deny_button',
  );
  ((hiddenDeny.attributes as Record<string, unknown>).visible as string) = 'false';
  assert.throws(
    () => qualifyAndroidCameraPrompt({ ...qualificationInput, tree: hidden }),
    /visible, enabled, and clickable/iu,
  );
});

void test('permission command contract remains available to the prompt producer', () => {
  const commands = buildAndroidCameraPermissionCommands('com.edufelip.mychampions.dev');
  assert.deepEqual(commands.revoke.slice(0, 4), ['shell', 'pm', 'revoke', '--user']);
});
