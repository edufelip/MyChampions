import assert from 'node:assert/strict';
import {
  ANDROID_CAMERA_APP_ID,
  ANDROID_CAMERA_SCENARIO,
  ANDROID_CAMERA_PERMISSION_DENY_RESOURCE,
  ANDROID_CAMERA_PERMISSION_MESSAGE_RESOURCE,
  type AndroidCameraSystemPackage,
  androidCameraPermissionResourceId,
  androidCameraExpectedAppLabel,
  isAndroidCameraSystemPackage,
  type AndroidCameraCommandReceipt,
  type AndroidCameraFrameSource,
  type AndroidCameraRuntimeIdentity,
} from './native-camera-android-contract';
import {
  AndroidCameraProducerUnavailable,
  requireAndroidCameraProducerOutput,
  runAndroidCameraDeniedProducer,
  type AndroidCameraFrameCapture,
  type AndroidCameraLocaleObserver,
  type AndroidCameraProducerContext,
  type AndroidCameraManualCodeInput,
  type AndroidCameraProducerReceipts,
  type AndroidCameraProxy,
  type AndroidCameraSnapshotSource,
  type AndroidCameraCommandRunner,
} from './native-camera-android-producer';
import { readQualifiedAndroidCameraLocaleEvidence } from './native-camera-android-runtime-locale';
import { normalizeNativeLocaleCommandOutput } from './native-locale-capture-seam';
import type { NativeLocaleBinding, NativeLocaleEvidence } from './locale-native-observation';
import type { AndroidStorageFileReceipt } from './native-android-session-adapter';
import type {
  AndroidCameraManualRequestBinding,
  AndroidCameraPromptSelector,
} from './native-camera-android-observation';
import type { readAndroidNativeLocaleProperties } from './native-locale-capture-seam';
import type { NativePilotSelection, NativePilotTarget } from './native-pilot-contract';
import type { NativeTrainingObserve } from './native-training-maestro-driver';
import type { NativeCommandExecution } from './owned-native-command';
import type { OwnedApiLifetimeProbe, OwnedFixtures } from './owned-session';

const HASH = /^[a-f0-9]{64}$/u;
export type AndroidCameraSavedFlow = Readonly<{
  binding: Readonly<{
    path: string;
    sha256: string;
    scenarioId: string;
    flowId: string;
    fixtureRef: string;
  }>;
  renderEntry: () => string;
  renderPrompt: () => string;
  renderDenied: (denySelector: string) => string;
  renderManual: () => string;
  renderSubmit: () => string;
  renderPending: (connectionId: string) => string;
}>;
type AndroidCameraFrameLabel = 'entry' | 'prompt' | 'denied' | 'manual' | 'pending';
const CAMERA_PROMPT_TITLE_BY_LOCALE = {
  'en-US': /^Allow\s+(.+?)\s+to take pictures and record video\?$/u,
  'pt-BR': /^Permitir que o app\s+(.+?)\s+tire fotos e grave vídeos\?$/u,
  'es-ES': /^¿Permitir que\s+(.+?)\s+haga fotos y grabe vídeos\?$/u,
} as const;
const CAMERA_DENY_TEXT_BY_LOCALE = {
  'en-US': /^(?:Don't allow|Don’t allow)$/u,
  'pt-BR': /^Não permitir$/u,
  'es-ES': /^No permitir$/u,
} as const;

type AndroidLocalePropertyBundle = Awaited<ReturnType<typeof readAndroidNativeLocaleProperties>>;

type FrameDescriptor = {
  source: AndroidCameraFrameSource;
  tree: unknown;
};

export type AndroidCameraCaptureBoundary = {
  output: string;
  fixtures: OwnedFixtures;
  selection: NativePilotSelection;
  selectionHash: string;
  captureRunId: string;
  ownerRunId: string;
  backendRunId: string;
  backendAttemptId: string;
  target: NativePilotTarget;
  serial: string;
  appId: string;
  expectedAppLabel: string;
  binaryHash: string;
  buildProfile: string;
  apiOrigin: string;
  apiPid: number;
  apiStarted: string;
  apiScript: string;
  expectedLocale: 'en-US' | 'pt-BR' | 'es-ES';
  expectedLocaleBinding: NativeLocaleBinding;
  localeProperties: AndroidLocalePropertyBundle;
  signal: AbortSignal;
  commands: AndroidCameraCommandRunner;
  observe: NativeTrainingObserve;
  execute: NativeTrainingObserve;
  frameDescriptors: ReadonlyMap<AndroidCameraFrameLabel, FrameDescriptor>;
  proxy: AndroidCameraProxy;
  snapshots: AndroidCameraSnapshotSource;
  probeApiLifetime: (signal?: AbortSignal) => Promise<OwnedApiLifetimeProbe>;
  readManualCodeReceipt: () => Promise<AndroidCameraManualCodeInput>;
  readSubmissionBinding: () => Promise<AndroidCameraManualRequestBinding>;
  prepareStudent: () => Promise<void>;
  /** Checked-in route source selected by the canonical inventory. */
  savedFlow: AndroidCameraSavedFlow;
  /** Injects the live invite only into the owned Maestro child environment. */
  setInviteCode: (value: string) => void;
};

export type AndroidCameraCleanupBoundary = {
  cleanup: 'not-acquired' | 'cleaned' | 'failed-recovery-retained';
  independentCensus: {
    status: 'complete' | 'unknown';
    foreignResources: readonly string[];
  };
};

function requireHash(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && HASH.test(value), `${label} is not a SHA-256`);
}

function nodeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function walkTree(tree: unknown): { path: string; node: Record<string, unknown> }[] {
  const root = nodeRecord(tree);
  if (!root)
    throw new AndroidCameraProducerUnavailable('Android camera hierarchy is not an object');
  const rows: { path: string; node: Record<string, unknown> }[] = [];
  const seen = new Set<object>();
  const pending: { path: string; node: Record<string, unknown> }[] = [{ path: 'root', node: root }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current.node))
      throw new AndroidCameraProducerUnavailable('Android camera hierarchy contains a cycle');
    seen.add(current.node);
    rows.push(current);
    const children = current.node.children;
    if (children === undefined) continue;
    if (!Array.isArray(children))
      throw new AndroidCameraProducerUnavailable('Android camera hierarchy children are malformed');
    for (let index = children.length - 1; index >= 0; index--) {
      const child = nodeRecord(children[index]);
      if (!child)
        throw new AndroidCameraProducerUnavailable('Android camera hierarchy child is malformed');
      pending.push({ path: `${current.path}/${index}`, node: child });
    }
  }
  return rows;
}

function nodeAttributes(node: Record<string, unknown>): Record<string, unknown> | null {
  const attributes = node.attributes;
  return attributes && typeof attributes === 'object' && !Array.isArray(attributes)
    ? (attributes as Record<string, unknown>)
    : null;
}

function textValues(node: Record<string, unknown>): string[] {
  const attributes = nodeAttributes(node);
  if (!attributes) return [];
  return ['text', 'accessibilityText', 'content-desc']
    .map((key) => attributes[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function resourceId(node: Record<string, unknown>): string | null {
  const value = nodeAttributes(node)?.['resource-id'];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function controllerPackageFromResourceId(value: string | null): AndroidCameraSystemPackage | null {
  if (!value) return null;
  const match =
    /^(com\.android\.permissioncontroller|com\.google\.android\.permissioncontroller):id\/.+$/u.exec(
      value,
    );
  return match && isAndroidCameraSystemPackage(match[1]) ? match[1] : null;
}

/** A package attribute is optional in Maestro's hierarchy; the resource ID is authoritative. */
function effectiveControllerPackage(
  node: Record<string, unknown>,
): AndroidCameraSystemPackage | null {
  const attributes = nodeAttributes(node);
  if (!attributes) return null;
  const fromResourceId = controllerPackageFromResourceId(resourceId(node));
  const packageAttribute = attributes.package;
  if (packageAttribute !== undefined && !isAndroidCameraSystemPackage(packageAttribute))
    return null;
  if (fromResourceId && packageAttribute !== undefined && packageAttribute !== fromResourceId)
    return null;
  return (
    fromResourceId ?? (isAndroidCameraSystemPackage(packageAttribute) ? packageAttribute : null)
  );
}

function hasUsableBounds(node: Record<string, unknown>): boolean {
  const bounds = nodeAttributes(node)?.bounds;
  if (typeof bounds !== 'string') return false;
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/u.exec(bounds);
  if (!match) return false;
  return Number(match[3]) > Number(match[1]) && Number(match[4]) > Number(match[2]);
}

/** Captured Maestro trees omit `visible`; bounds plus enabled is the positive visibility proof. */
function isPromptNodeActionable(node: Record<string, unknown>, requireClickable: boolean): boolean {
  const attributes = nodeAttributes(node);
  if (!attributes) return false;
  const visible =
    attributes.visible === undefined
      ? hasUsableBounds(node)
      : attributes.visible === true || attributes.visible === 'true';
  const enabled = attributes.enabled === true || attributes.enabled === 'true';
  const clickable = attributes.clickable === true || attributes.clickable === 'true';
  return visible && enabled && (!requireClickable || clickable);
}

function ancestorPath(ancestor: string, descendant: string): boolean {
  return descendant === ancestor || descendant.startsWith(`${ancestor}/`);
}

function selectorForResourceId(
  row: { path: string; node: Record<string, unknown> },
  expectedResource: string,
): AndroidCameraPromptSelector | null {
  if (resourceId(row.node) !== expectedResource) return null;
  return { attribute: 'resource-id', value: expectedResource, path: row.path };
}

function parseCameraPromptAppLabel(value: string, locale: string): string | null {
  const pattern =
    CAMERA_PROMPT_TITLE_BY_LOCALE[locale as keyof typeof CAMERA_PROMPT_TITLE_BY_LOCALE];
  if (!pattern) return null;
  const match = pattern.exec(value);
  const label = match?.[1]?.replace(/\s+/gu, ' ').trim();
  return label && label.length <= 128 ? label : null;
}

/**
 * Resolve the exact Android PermissionController controls from a real Maestro
 * hierarchy. The prompt contract is intentionally closed: supported package,
 * resource IDs, localized title, expected build label, and actionable deny
 * control must all agree on one controller subtree.
 */
export function deriveAndroidCameraPromptSpec(input: {
  source: AndroidCameraFrameSource;
  tree: unknown;
  serial: string;
  apiLevel: number;
  locale: string;
  expectedAppLabel: string;
}): {
  appLabel: string;
  promptRootPath: string;
  title: AndroidCameraPromptSelector;
  deny: AndroidCameraPromptSelector;
  systemPackage: AndroidCameraSystemPackage;
  serial: string;
  apiLevel: number;
  locale: string;
  appPackageName: typeof ANDROID_CAMERA_APP_ID;
} {
  assert.equal(input.source.label, 'prompt');
  assert(
    input.locale in CAMERA_PROMPT_TITLE_BY_LOCALE,
    `Unsupported Android camera prompt locale: ${input.locale}`,
  );
  assert(
    typeof input.expectedAppLabel === 'string' &&
      input.expectedAppLabel.trim() === input.expectedAppLabel &&
      input.expectedAppLabel.length > 0 &&
      input.expectedAppLabel.length <= 128,
    'Android camera expected app label is invalid',
  );
  const titlePattern =
    CAMERA_PROMPT_TITLE_BY_LOCALE[input.locale as keyof typeof CAMERA_PROMPT_TITLE_BY_LOCALE];
  const denyPattern =
    CAMERA_DENY_TEXT_BY_LOCALE[input.locale as keyof typeof CAMERA_DENY_TEXT_BY_LOCALE];
  const rows = walkTree(input.tree);
  const titleRows = rows.filter(
    (row) =>
      controllerPackageFromResourceId(resourceId(row.node)) !== null &&
      resourceId(row.node)?.endsWith(`:id/${ANDROID_CAMERA_PERMISSION_MESSAGE_RESOURCE}`),
  );
  if (titleRows.length !== 1)
    throw new AndroidCameraProducerUnavailable(
      'Android camera permission title resource is missing or ambiguous',
    );
  const denyRows = rows.filter(
    (row) =>
      controllerPackageFromResourceId(resourceId(row.node)) !== null &&
      resourceId(row.node)?.endsWith(`:id/${ANDROID_CAMERA_PERMISSION_DENY_RESOURCE}`),
  );
  if (denyRows.length !== 1)
    throw new AndroidCameraProducerUnavailable(
      'Android camera denial resource is missing or ambiguous',
    );
  const titlePackage = effectiveControllerPackage(titleRows[0].node);
  const denyPackage = effectiveControllerPackage(denyRows[0].node);
  if (!titlePackage || !denyPackage || titlePackage !== denyPackage)
    throw new AndroidCameraProducerUnavailable(
      'Android camera permission controls use mixed or unsupported controllers',
    );
  const expectedTitleResource = androidCameraPermissionResourceId(
    titlePackage,
    ANDROID_CAMERA_PERMISSION_MESSAGE_RESOURCE,
  );
  const expectedDenyResource = androidCameraPermissionResourceId(
    titlePackage,
    ANDROID_CAMERA_PERMISSION_DENY_RESOURCE,
  );
  const title = selectorForResourceId(titleRows[0], expectedTitleResource);
  const deny = selectorForResourceId(denyRows[0], expectedDenyResource);
  if (
    !title ||
    !deny ||
    !isPromptNodeActionable(titleRows[0].node, false) ||
    !isPromptNodeActionable(denyRows[0].node, true)
  )
    throw new AndroidCameraProducerUnavailable(
      'Android camera permission controls are not visible, enabled, and actionable',
    );
  const titleText = textValues(titleRows[0].node).find((value) => titlePattern.test(value));
  if (!titleText)
    throw new AndroidCameraProducerUnavailable(
      'Android camera permission title text is missing or not the supported Android contract',
    );
  const appLabel = parseCameraPromptAppLabel(titleText, input.locale);
  if (!appLabel || appLabel !== input.expectedAppLabel)
    throw new AndroidCameraProducerUnavailable(
      'Android camera permission prompt belongs to a different app label',
    );
  const denyText = textValues(denyRows[0].node).find((value) => denyPattern.test(value));
  if (!denyText)
    throw new AndroidCameraProducerUnavailable(
      'Android camera denial text is missing or not the supported Android locale contract',
    );

  const supportedControllerRows = rows.filter(
    (row) => effectiveControllerPackage(row.node) === titlePackage,
  );
  const promptRoots = supportedControllerRows.filter(
    (row) =>
      ancestorPath(row.path, titleRows[0].path) &&
      ancestorPath(row.path, denyRows[0].path) &&
      !supportedControllerRows.some(
        (other) => other.path !== row.path && ancestorPath(other.path, row.path),
      ),
  );
  if (promptRoots.length !== 1)
    throw new AndroidCameraProducerUnavailable(
      'Android camera permission controls are not in one controller subtree',
    );
  return {
    appLabel,
    promptRootPath: promptRoots[0].path,
    title,
    deny,
    systemPackage: titlePackage,
    serial: input.serial,
    apiLevel: input.apiLevel,
    locale: input.locale,
    appPackageName: ANDROID_CAMERA_APP_ID,
  };
}

function requireFrameDescriptor(
  label: string,
  row: FrameDescriptor | undefined,
): asserts row is FrameDescriptor {
  if (!row) throw new AndroidCameraProducerUnavailable(`Android camera frame is missing: ${label}`);
  assert.equal(row.source.label, label);
  requireHash(row.source.receipt.sha256, `${label} frame hash`);
  assert(row.source.receipt.sizeBytes > 0);
  assert(row.source.command.execution.execution === 'completed');
  assert(row.source.command.execution.cleanup === 'cleaned');
}

export function buildAndroidCameraFrameCapture(input: {
  observe: NativeTrainingObserve;
  execute: NativeTrainingObserve;
  savedFlow: AndroidCameraSavedFlow;
  setInviteCode: (value: string) => void;
  descriptors: ReadonlyMap<string, FrameDescriptor>;
  serial: string;
  apiLevel: number;
  locale: string;
  expectedAppLabel: string;
}): AndroidCameraFrameCapture {
  return {
    observe: input.observe,
    execute: input.execute,
    savedFlow: input.savedFlow,
    setInviteCode: input.setInviteCode,
    frameSource: (label) =>
      Promise.resolve().then(() => {
        const descriptor = input.descriptors.get(label);
        requireFrameDescriptor(label, descriptor);
        return structuredClone(descriptor.source);
      }),
    promptSpec: ({ source, tree }) =>
      Promise.resolve().then(() =>
        deriveAndroidCameraPromptSpec({
          source,
          tree,
          serial: input.serial,
          apiLevel: input.apiLevel,
          locale: input.locale,
          expectedAppLabel: input.expectedAppLabel,
        }),
      ),
  };
}

export function buildAndroidCameraLocaleObserver(input: {
  artifactRoot: string;
  hierarchyPath: string;
  properties: AndroidLocalePropertyBundle;
  expectedLocale: 'en-US' | 'pt-BR' | 'es-ES';
  expectedBinding: NativeLocaleBinding;
}): AndroidCameraLocaleObserver {
  return {
    expectedLocale: input.expectedLocale,
    expectedBinding: structuredClone(input.expectedBinding),
    readEvidence: ({ properties, signal }) =>
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        const normalized = normalizeNativeLocaleCommandOutput({
          binding: input.expectedBinding,
          command: properties.selected,
        });
        if (!normalized.observedOsLocale)
          throw new AndroidCameraProducerUnavailable(
            `Android effective locale observation unavailable: ${normalized.blocker ?? 'unknown'}`,
          );
        try {
          return readQualifiedAndroidCameraLocaleEvidence({
            artifactRoot: input.artifactRoot,
            hierarchyPath: input.hierarchyPath,
            properties,
            expectedLocale: input.expectedLocale,
            expectedBinding: input.expectedBinding,
          });
        } catch (error) {
          throw new AndroidCameraProducerUnavailable(
            `Android effective app locale runtime observation is not qualified: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }),
  };
}

export function buildAndroidCameraRuntimeIdentity(input: {
  captureRunId: string;
  ownerRunId: string;
  backendRunId: string;
  backendAttemptId: string;
  serial: string;
  appId: string;
  apiOrigin: string;
  apiPid: number;
  apiStarted: string;
  apiScript: string;
  target: NativePilotTarget;
  locale: NativeLocaleEvidence;
}): AndroidCameraRuntimeIdentity {
  assert.equal(input.appId, ANDROID_CAMERA_APP_ID);
  assert.equal(input.target.appId, input.appId);
  assert.equal(input.target.deviceId, input.serial);
  assert.equal(input.backendAttemptId, `${input.backendRunId}:first`);
  requireHash(input.target.binaryHash, 'Android camera binary hash');
  return structuredClone(input);
}

export function buildAndroidCameraCommandReceipt(input: {
  label: string;
  captureRunId: string;
  ownerRunId: string;
  serial: string;
  appId: string;
  attemptId: string;
  argv: readonly string[];
  execution: NativeCommandExecution;
  stdout: AndroidStorageFileReceipt | null;
}): AndroidCameraCommandReceipt {
  assert.equal(input.execution.phase, 'step');
  assert.equal(input.execution.execution, 'completed');
  assert.equal(input.execution.cleanup, 'cleaned');
  const pid = input.execution.pid;
  const pgid = input.execution.pgid;
  if (pid === null || pgid === null || !Number.isSafeInteger(pid) || !Number.isSafeInteger(pgid))
    throw new Error('Android camera command process identity is missing');
  if (pid <= 1 || pgid <= 1) throw new Error('Android camera command process identity is missing');
  assert(typeof input.label === 'string' && /^[a-z0-9-]+$/u.test(input.label));
  return {
    label: input.label,
    captureRunId: input.captureRunId,
    ownerRunId: input.ownerRunId,
    serial: input.serial,
    appId: input.appId,
    attemptId: input.attemptId,
    argv: [...input.argv],
    execution: structuredClone(input.execution),
    stdout: input.stdout ? structuredClone(input.stdout) : null,
  };
}

export function buildAndroidCameraContext(
  input: AndroidCameraCaptureBoundary,
): AndroidCameraProducerContext {
  assert.equal(input.selection.arguments.platform, 'android');
  assert.equal(input.selection.arguments.engine, 'maestro');
  assert.equal(input.selection.arguments.scenario, ANDROID_CAMERA_SCENARIO);
  assert.equal(input.selection.arguments.mode, 'integration');
  assert.equal(input.savedFlow.binding.path, input.selection.scenario.maestroFlow);
  assert.equal(input.savedFlow.binding.scenarioId, input.selection.scenario.id);
  assert.equal(input.savedFlow.binding.flowId, input.selection.scenario.flowId);
  assert.equal(input.savedFlow.binding.fixtureRef, input.selection.scenario.fixtureRef);
  assert.match(input.savedFlow.binding.sha256, HASH);
  assert.equal(input.appId, ANDROID_CAMERA_APP_ID);
  assert.equal(input.expectedAppLabel, androidCameraExpectedAppLabel(input.appId));
  assert.equal(input.backendAttemptId, `${input.backendRunId}:first`);
  assert(typeof input.target.osVersion === 'string' && input.target.osVersion.length > 0);
  return {
    output: input.output,
    fixtures: input.fixtures,
    identity: buildAndroidCameraRuntimeIdentity({
      captureRunId: input.captureRunId,
      ownerRunId: input.ownerRunId,
      backendRunId: input.backendRunId,
      backendAttemptId: input.backendAttemptId,
      serial: input.serial,
      appId: input.appId,
      apiOrigin: input.apiOrigin,
      apiPid: input.apiPid,
      apiStarted: input.apiStarted,
      apiScript: input.apiScript,
      target: input.target,
      locale: {
        schemaVersion: 1,
        requestedLocale: input.expectedLocale,
        observedOsLocale: {
          status: 'absent',
          source: 'android-getprop',
          raw: null,
          resolved: null,
          normalization: 'none',
        },
        effectiveAppLocale: {
          hydration: 'unobserved',
          source: 'unobserved',
          value: null,
        },
        override: { status: 'unobserved', source: 'unobserved', value: null },
        binding: input.expectedLocaleBinding,
      },
    }),
    selectionHash: input.selectionHash,
    signal: input.signal,
    commands: input.commands,
    capture: buildAndroidCameraFrameCapture({
      observe: input.observe,
      execute: input.execute,
      savedFlow: input.savedFlow,
      setInviteCode: input.setInviteCode,
      descriptors: input.frameDescriptors,
      serial: input.serial,
      apiLevel: Number(input.target.osVersion.match(/\d+/u)?.[0] ?? 0),
      locale: input.expectedLocale,
      expectedAppLabel: input.expectedAppLabel,
    }),
    locale: buildAndroidCameraLocaleObserver({
      artifactRoot: input.output,
      // The outer capture already records the first stable app hierarchy
      // before any camera mutation. Reusing that exact private file binds
      // locale evidence to the producer's real capture rather than inventing
      // a second hierarchy artifact.
      hierarchyPath: 'entry-hierarchy.json',
      properties: input.localeProperties,
      expectedLocale: input.expectedLocale,
      expectedBinding: input.expectedLocaleBinding,
    }),
    proxy: input.proxy,
    snapshots: input.snapshots,
    probeApiLifetime: input.probeApiLifetime,
    readManualCodeReceipt: input.readManualCodeReceipt,
    readSubmissionBinding: input.readSubmissionBinding,
  };
}

/**
 * The outer capture calls this only after target/build/API/fixtures and the
 * locale/frame descriptors are actual receipts. It does not convert a missing
 * seam into Pending success.
 */
export async function runAndroidCameraCaptureCallback(
  input: AndroidCameraCaptureBoundary & {
    localeProperties: AndroidLocalePropertyBundle;
  },
): Promise<AndroidCameraProducerReceipts> {
  const context = buildAndroidCameraContext(input);
  const result = await runAndroidCameraDeniedProducer(context);
  return requireAndroidCameraProducerOutput(result, {
    selectionHash: input.selectionHash,
    runId: input.captureRunId,
  });
}
