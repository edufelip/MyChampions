import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  normalizeDetoxElementAttributes,
  parseDetoxViewHierarchyXml,
  resolveActiveConnectionCardFromDetoxXml,
  resolvePendingConnectionTargetFromDetoxXml,
  type DetoxElementAttributesResult,
} from './detox-native-hierarchy';
import {
  resolveActiveConnectionCard,
  resolvePendingConnectionTarget,
  type ActiveConnectionCardMatch,
  type NativeConnectionTargetScope,
  type PendingConnectionTargetMatch,
} from './native-connection-hierarchy';
import type { OwnedConnectionSnapshot } from './native-connection-snapshot';

export type DetoxConnectionActionKind = 'accept' | 'end';

/**
 * The parent binds the action to the same private fixture snapshot used by the
 * connection controller. The child never accepts an arbitrary selector for an
 * Accept or End tap; it derives the selector from the retained hierarchy and
 * this target identity.
 */
export type DetoxConnectionActionRequest = Readonly<{
  kind: DetoxConnectionActionKind;
  target: NativeConnectionTargetScope;
  snapshot: OwnedConnectionSnapshot;
}>;

export type DetoxConnectionActionResolution = Readonly<{
  kind: DetoxConnectionActionKind;
  selector: string;
  path: readonly number[];
}>;

export type DetoxConnectionActionResult = Readonly<{
  kind: DetoxConnectionActionKind;
  selector: string;
  selectorKind: 'id';
  hierarchyXml: string;
  attributesBefore: DetoxElementAttributesResult;
  attributesAfter: DetoxElementAttributesResult;
  resolution: DetoxConnectionActionResolution;
  tapCompleted: true;
}>;

export type DetoxConnectionActionElement = Readonly<{
  getAttributes(): Promise<DetoxElementAttributesResult>;
  tap(): Promise<void>;
}>;

export type DetoxConnectionActionDriver = Readonly<{
  generateViewHierarchyXml(): Promise<string>;
  elementForSelector(selector: string): DetoxConnectionActionElement;
  /** Fence every Detox operation with the child cancellation envelope. */
  runOwned<T>(operation: () => Promise<T>): Promise<T>;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  return value;
}

function requireTargetScope(value: unknown): NativeConnectionTargetScope {
  const row = record(value, 'Detox action target');
  const fixtureAuthUids = row.fixtureAuthUids;
  assert(
    Array.isArray(fixtureAuthUids) &&
      fixtureAuthUids.length > 0 &&
      fixtureAuthUids.every((item) => typeof item === 'string' && item.length > 0) &&
      new Set(fixtureAuthUids).size === fixtureAuthUids.length,
    'Detox action fixture identities are invalid',
  );
  const validatedFixtureAuthUids = fixtureAuthUids as unknown as string[];
  return {
    runId: requireNonEmptyString(row.runId, 'Detox action run ID'),
    scope: requireNonEmptyString(row.scope, 'Detox action fixture scope'),
    fixtureAuthUids: [...validatedFixtureAuthUids].sort(),
    professionalAuthUid: requireNonEmptyString(
      row.professionalAuthUid,
      'Detox action professional identity',
    ),
    studentAuthUid: requireNonEmptyString(row.studentAuthUid, 'Detox action student identity'),
  };
}

function requireSnapshot(
  value: unknown,
  target: NativeConnectionTargetScope,
): OwnedConnectionSnapshot {
  const row = record(value, 'Detox action snapshot');
  assert.equal(row.schemaVersion, 1);
  assert.equal(row.kind, 'connection-snapshot-v1');
  assert.equal(row.readOnly, true);
  assert.equal(row.runId, target.runId);
  assert.equal(row.scope, target.scope);
  const snapshotFixtureAuthUids = row.fixtureAuthUids;
  assert(
    Array.isArray(snapshotFixtureAuthUids) &&
      snapshotFixtureAuthUids.every((item) => typeof item === 'string' && item.length > 0),
    'Detox action snapshot fixture identities are invalid',
  );
  const validatedSnapshotFixtureAuthUids = snapshotFixtureAuthUids as unknown as string[];
  assert.deepEqual(
    [...validatedSnapshotFixtureAuthUids].sort(),
    [...target.fixtureAuthUids].sort(),
    'Detox action snapshot fixture identities differ from the command target',
  );
  const snapshotTarget = record(row.target, 'Detox action snapshot target');
  assert.equal(snapshotTarget.professionalAuthUid, target.professionalAuthUid);
  assert.equal(snapshotTarget.studentAuthUid, target.studentAuthUid);
  assert.equal(snapshotTarget.specialty, 'fitness_coach');
  assert(row.rows && typeof row.rows === 'object' && !Array.isArray(row.rows));
  assert(row.rowCounts && typeof row.rowCounts === 'object' && !Array.isArray(row.rowCounts));
  return row as unknown as OwnedConnectionSnapshot;
}

/** Validate the action bundle before it can cross the parent/Detox child boundary. */
export function requireDetoxConnectionActionRequest(value: unknown): DetoxConnectionActionRequest {
  const row = record(value, 'Detox connection action');
  assert(row.kind === 'accept' || row.kind === 'end', 'Detox connection action kind is invalid');
  const target = requireTargetScope(row.target);
  const snapshot = requireSnapshot(row.snapshot, target);
  return { kind: row.kind, target, snapshot };
}

function actionSelector(
  kind: DetoxConnectionActionKind,
  match: PendingConnectionTargetMatch | ActiveConnectionCardMatch,
): string {
  return kind === 'accept'
    ? (match as PendingConnectionTargetMatch).acceptSelector
    : (match as ActiveConnectionCardMatch).unbindSelector;
}

function actionPath(
  kind: DetoxConnectionActionKind,
  match: PendingConnectionTargetMatch | ActiveConnectionCardMatch,
): readonly number[] {
  return kind === 'accept'
    ? (match as PendingConnectionTargetMatch).acceptPath
    : (match as ActiveConnectionCardMatch).unbindPath;
}

function selectMatch(input: {
  kind: DetoxConnectionActionKind;
  xml: string;
  platform: 'ios' | 'android';
  snapshot: OwnedConnectionSnapshot;
  target: NativeConnectionTargetScope;
}): PendingConnectionTargetMatch | ActiveConnectionCardMatch {
  const tree = parseDetoxViewHierarchyXml(input.xml, input.platform);
  return input.kind === 'accept'
    ? resolvePendingConnectionTarget({ tree, snapshot: input.snapshot, target: input.target })
    : resolveActiveConnectionCard({ tree, snapshot: input.snapshot, target: input.target });
}

/** Select the identity-bound Accept target before reading its actual attributes. */
export function selectDetoxConnectionAcceptTarget(input: {
  xml: string;
  platform: 'ios' | 'android';
  snapshot: OwnedConnectionSnapshot;
  target: NativeConnectionTargetScope;
}): DetoxConnectionActionResolution {
  const match = selectMatch({ ...input, kind: 'accept' });
  return {
    kind: 'accept',
    selector: actionSelector('accept', match),
    path: actionPath('accept', match),
  };
}

/** Select the identity-bound End target before reading its actual attributes. */
export function selectDetoxConnectionEndTarget(input: {
  xml: string;
  platform: 'ios' | 'android';
  snapshot: OwnedConnectionSnapshot;
  target: NativeConnectionTargetScope;
}): DetoxConnectionActionResolution {
  const match = selectMatch({ ...input, kind: 'end' });
  return { kind: 'end', selector: actionSelector('end', match), path: actionPath('end', match) };
}

/**
 * Resolve and qualify an actual Accept target. The caller must provide the
 * element.getAttributes() result; XML alone is deliberately insufficient.
 */
export function resolveDetoxConnectionAcceptTarget(input: {
  xml: string;
  platform: 'ios' | 'android';
  snapshot: OwnedConnectionSnapshot;
  target: NativeConnectionTargetScope;
  elementAttributes: DetoxElementAttributesResult;
}): DetoxConnectionActionResolution {
  const match = resolvePendingConnectionTargetFromDetoxXml(input);
  return { kind: 'accept', selector: match.acceptSelector, path: match.acceptPath };
}

/**
 * Resolve and qualify an actual End target. The caller must provide the
 * element.getAttributes() result; XML alone is deliberately insufficient.
 */
export function resolveDetoxConnectionEndTarget(input: {
  xml: string;
  platform: 'ios' | 'android';
  snapshot: OwnedConnectionSnapshot;
  target: NativeConnectionTargetScope;
  elementAttributes: DetoxElementAttributesResult;
}): DetoxConnectionActionResolution {
  const match = resolveActiveConnectionCardFromDetoxXml(input);
  return { kind: 'end', selector: match.unbindSelector, path: match.unbindPath };
}

function frameOf(value: DetoxElementAttributesResult, platform: 'ios' | 'android') {
  const attributes = normalizeDetoxElementAttributes(value);
  assert.equal(attributes.enabled, true, 'Detox action target is disabled');
  assert.equal(attributes.visible, true, 'Detox action target is not visible');
  if (platform === 'ios')
    assert(
      'hittable' in attributes && attributes.hittable === true,
      'Detox iOS action target is not hittable',
    );
  assert(
    attributes.frame.width > 0 && attributes.frame.height > 0,
    'Detox action target has an empty frame',
  );
  return attributes.frame;
}

function requireStableActionAttributes(input: {
  platform: 'ios' | 'android';
  selector: string;
  before: DetoxElementAttributesResult;
  after: DetoxElementAttributesResult;
}): void {
  const before = normalizeDetoxElementAttributes(input.before);
  const after = normalizeDetoxElementAttributes(input.after);
  assert.equal(before.identifier, input.selector);
  assert.equal(after.identifier, input.selector);
  assert.deepEqual(frameOf(before, input.platform), frameOf(after, input.platform));
}

function throwIfStopped(signal: AbortSignal | undefined, deadlineAt: number | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Detox action cancelled');
  if (deadlineAt !== undefined && (!Number.isFinite(deadlineAt) || deadlineAt <= performance.now()))
    throw new Error('Detox action deadline elapsed');
}

/**
 * Real child-side action boundary. It derives a selector from the current
 * hierarchy, reads the actual Detox element twice, invokes the actionability
 * resolver with those facts, and taps only after the resolver succeeds.
 */
export async function runDetoxConnectionAction(input: {
  action: DetoxConnectionActionRequest;
  platform: 'ios' | 'android';
  driver: DetoxConnectionActionDriver;
  signal?: AbortSignal;
  deadlineAt?: number;
}): Promise<DetoxConnectionActionResult> {
  const { action, platform, driver, signal, deadlineAt } = input;
  throwIfStopped(signal, deadlineAt);
  const initialXml = await driver.runOwned(() => driver.generateViewHierarchyXml());
  throwIfStopped(signal, deadlineAt);
  const selected =
    action.kind === 'accept'
      ? selectDetoxConnectionAcceptTarget({
          xml: initialXml,
          platform,
          snapshot: action.snapshot,
          target: action.target,
        })
      : selectDetoxConnectionEndTarget({
          xml: initialXml,
          platform,
          snapshot: action.snapshot,
          target: action.target,
        });
  const element = driver.elementForSelector(selected.selector);
  const attributesBefore = await driver.runOwned(() => element.getAttributes());
  throwIfStopped(signal, deadlineAt);
  const hierarchyXml = await driver.runOwned(() => driver.generateViewHierarchyXml());
  const attributesAfter = await driver.runOwned(() => element.getAttributes());
  throwIfStopped(signal, deadlineAt);
  requireStableActionAttributes({
    platform,
    selector: selected.selector,
    before: attributesBefore,
    after: attributesAfter,
  });
  const resolved =
    action.kind === 'accept'
      ? resolveDetoxConnectionAcceptTarget({
          xml: hierarchyXml,
          platform,
          snapshot: action.snapshot,
          target: action.target,
          elementAttributes: attributesAfter,
        })
      : resolveDetoxConnectionEndTarget({
          xml: hierarchyXml,
          platform,
          snapshot: action.snapshot,
          target: action.target,
          elementAttributes: attributesAfter,
        });
  assert.equal(resolved.selector, selected.selector, 'Detox action target changed before tap');
  await driver.runOwned(() => element.tap());
  throwIfStopped(signal, deadlineAt);
  return {
    kind: action.kind,
    selector: selected.selector,
    selectorKind: 'id',
    hierarchyXml,
    attributesBefore,
    attributesAfter,
    resolution: resolved,
    tapCompleted: true,
  };
}
