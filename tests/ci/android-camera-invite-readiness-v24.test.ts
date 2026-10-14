import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildAndroidCoachHomeObservation } from '../../scripts/testing/capture-android-testability';
import { requirePlatformConnectionInviteCode } from '../../scripts/testing/native-connection-journey-core';
import { ANDROID_CONNECTION_PLATFORM } from '../../scripts/testing/native-connection-platform-contract';

const FIXTURE_PATH = new URL('../fixtures/android-camera-coach-invite-v24.json', import.meta.url)
  .pathname;
const FIXTURE_SHA256 = '8bdb1b88088841f7d02a82b72114228a25b4c1c2223c9f0aabbb2a48ae0676d8';
const INVITE_ID = 'pro.home.inviteCodeValue';
const CAPTURE_SOURCE_PATH = new URL(
  '../../scripts/testing/capture-android-testability.ts',
  import.meta.url,
).pathname;

type JsonRecord = Record<string, unknown>;

function findNodes(tree: unknown, predicate: (node: JsonRecord) => boolean): JsonRecord[] {
  const matches: JsonRecord[] = [];
  const visit = (value: unknown) => {
    assert(value && typeof value === 'object' && !Array.isArray(value));
    const node = value as JsonRecord;
    if (predicate(node)) matches.push(node);
    if (node.children !== undefined) {
      assert(Array.isArray(node.children));
      node.children.forEach(visit);
    }
  };
  visit(tree);
  return matches;
}

function inviteNodes(tree: unknown): JsonRecord[] {
  return findNodes(tree, (node) => {
    const attributes = node.attributes;
    return Boolean(
      attributes &&
      typeof attributes === 'object' &&
      !Array.isArray(attributes) &&
      (attributes as JsonRecord)['resource-id'] === INVITE_ID,
    );
  });
}

async function readTree(state: 'before' | 'after'): Promise<unknown> {
  const bytes = await readFile(FIXTURE_PATH);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), FIXTURE_SHA256);
  const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  return structuredClone(value[state]);
}

void test('camera coach readiness scrolls before preserving the original coach-home receipt', () => {
  const scrolled = buildAndroidCoachHomeObservation({
    email: 'coach@example.test',
    password: 'fixture-password',
    requireInviteCode: true,
  });
  assert.deepEqual(scrolled.selectors, ['pro.home.screen', INVITE_ID]);
  assert.equal(scrolled.actions.match(/scrollUntilVisible:/gu)?.length, 1);
  assert.match(
    scrolled.actions,
    /extendedWaitUntil:\n    visible:\n      id: pro\.home\.screen\n    timeout: 30000/u,
  );
  assert(
    scrolled.actions.indexOf('extendedWaitUntil:') <
      scrolled.actions.indexOf('scrollUntilVisible:'),
  );
  assert.match(
    scrolled.actions,
    /id: pro\.home\.inviteCodeValue\n    direction: DOWN\n    timeout: 30000\n    centerElement: true/u,
  );

  const inventory = buildAndroidCoachHomeObservation({
    email: 'coach@example.test',
    password: 'fixture-password',
    requireInviteCode: false,
  });
  assert.deepEqual(inventory.selectors, ['pro.home.screen']);
  assert.doesNotMatch(inventory.actions, /scrollUntilVisible:/u);
});

void test('Android camera callback reads the scrolled coach-home receipt with the Android contract', async () => {
  const source = await readFile(CAPTURE_SOURCE_PATH, 'utf8');
  assert.match(source, /buildAndroidCoachHomeObservation\(\{/u);
  assert.match(
    source,
    /requireInviteCode:\s*charter === (['"])connection-journey\1 \|\| isCameraCharter/u,
  );
  assert.match(source, /observedTrees\.get\((['"])coach-home\1\)/u);
  assert.match(source, /observedFrameReceipts\.get\((['"])coach-home\1\)/u);
  assert.match(source, /row\.label === (['"])coach-home-hierarchy\1/u);
  assert.match(source, /requirePlatformConnectionInviteCode\(/u);
  assert.match(source, /ANDROID_CONNECTION_PLATFORM/u);
  assert.doesNotMatch(source, /requireNativeConnectionInviteCode/u);
});

void test('portable viewport fixture rejects absent invite and accepts the scrolled control', async () => {
  const beforeScroll = await readTree('before');
  assert.equal(inviteNodes(beforeScroll).length, 0);
  assert.throws(
    () => requirePlatformConnectionInviteCode(beforeScroll, ANDROID_CONNECTION_PLATFORM),
    /absent or duplicated/u,
  );

  const afterScroll = await readTree('after');
  const actualInvites = inviteNodes(afterScroll);
  assert.equal(actualInvites.length, 1);
  const attributes = actualInvites[0].attributes as JsonRecord;
  assert.equal(attributes.text, '');
  assert.equal(
    requirePlatformConnectionInviteCode(afterScroll, ANDROID_CONNECTION_PLATFORM),
    'A1B2C3D4',
  );
});

void test('Android invite text and accessibility values must resolve to one code', async () => {
  const actual = await readTree('after');

  const duplicate = structuredClone(actual);
  const invite = inviteNodes(duplicate)[0];
  const parent = findNodes(duplicate, (node) => {
    const children = node.children;
    return Array.isArray(children) && children.includes(invite);
  })[0];
  assert(parent && Array.isArray(parent.children));
  parent.children.push(structuredClone(invite));
  assert.throws(
    () => requirePlatformConnectionInviteCode(duplicate, ANDROID_CONNECTION_PLATFORM),
    /absent or duplicated/u,
  );

  const foreign = structuredClone(actual);
  const foreignAttributes = inviteNodes(foreign)[0].attributes as JsonRecord;
  foreignAttributes['resource-id'] = 'pro.home.foreignInvite';
  assert.throws(
    () => requirePlatformConnectionInviteCode(foreign, ANDROID_CONNECTION_PLATFORM),
    /absent or duplicated/u,
  );

  const malformed = structuredClone(actual);
  const malformedAttributes = inviteNodes(malformed)[0].attributes as JsonRecord;
  malformedAttributes.accessibilityText = 'Your invite code: arbitrary';
  assert.throws(
    () => requirePlatformConnectionInviteCode(malformed, ANDROID_CONNECTION_PLATFORM),
    /format differs/u,
  );

  const disagreement = structuredClone(actual);
  const disagreementAttributes = inviteNodes(disagreement)[0].attributes as JsonRecord;
  disagreementAttributes.text = 'A1B2C3D5';
  assert.throws(
    () => requirePlatformConnectionInviteCode(disagreement, ANDROID_CONNECTION_PLATFORM),
    /text attributes disagree/u,
  );
});
