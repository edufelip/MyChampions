export const iosCredentialEntryDiagnosticKind = 'private-ios-credential-entry-diagnostic' as const;
export const iosCredentialEntryDiagnosticSchemaVersion = 1 as const;

export const iosCredentialEntryDiagnosticStages = [
  'entry',
  'email-after-tap',
  'email-after-input',
] as const;
export type IosCredentialEntryDiagnosticStage = (typeof iosCredentialEntryDiagnosticStages)[number];

export const iosCredentialEntryDiagnosticSelectors = {
  email: 'auth.signIn.emailInput',
  password: 'auth.signIn.passwordInput',
  submit: 'auth.signIn.submitButton',
} as const;

export type IosCredentialEntryDiagnosticActionKind = 'observation' | 'tap-email' | 'input-email';
export type IosCredentialEntryDiagnosticActionStatus = 'completed' | 'failed' | 'blocked';
export type IosCredentialEntryDiagnosticKeyboardState = 'visible' | 'hidden' | 'unknown';
export type IosCredentialEntryDiagnosticAppBoundary =
  'same-app-instance' | 'relaunch-observed' | 'unknown';
type SameFieldAssertionStatus = 'passed' | 'failed' | 'not-run';
type PresenceState = 'present' | 'absent' | 'unknown';
type FocusState = 'focused' | 'not-focused' | 'unknown';
type ValueState = 'nonempty' | 'empty' | 'absent' | 'unknown';
type BoundsState = string | null;
const boundsPattern = /^\[\d+,\d+\]\[\d+,\d+\]$/;

export type IosCredentialEntryDiagnosticAction = {
  kind: IosCredentialEntryDiagnosticActionKind;
  status: IosCredentialEntryDiagnosticActionStatus;
  selector: string | null;
  retryCount: number;
  coordinatesUsed: boolean;
  optionalAssertionsUsed: boolean;
  credentialValueRecorded: false;
};

export type IosCredentialEntryDiagnosticEvidence = {
  hierarchySha256: string | null;
  screenshotSha256: string | null;
  commandReceiptSha256: string;
};

export type IosCredentialEntryDiagnosticSnapshot = {
  stage: IosCredentialEntryDiagnosticStage;
  sequence: number;
  hierarchy: unknown;
  keyboard: IosCredentialEntryDiagnosticKeyboardState;
  appBoundary: IosCredentialEntryDiagnosticAppBoundary;
  action: IosCredentialEntryDiagnosticAction;
  evidence: IosCredentialEntryDiagnosticEvidence;
  sameFieldAssertion?: {
    selector: typeof iosCredentialEntryDiagnosticSelectors.email;
    status: Exclude<SameFieldAssertionStatus, 'not-run'>;
    exactValueBound: true;
  };
};

type FieldDiagnostic = {
  presence: PresenceState;
  value: ValueState;
  focus: FocusState;
  /** Native target bounds when the hierarchy supplied a validated bounds attribute. */
  bounds: BoundsState;
};

type SnapshotDiagnostic = {
  stage: IosCredentialEntryDiagnosticStage;
  sequence: number;
  email: FieldDiagnostic;
  password: FieldDiagnostic;
  submit: PresenceState;
  keyboard: IosCredentialEntryDiagnosticKeyboardState;
  appBoundary: IosCredentialEntryDiagnosticAppBoundary;
  actionStatus: IosCredentialEntryDiagnosticActionStatus;
  sameFieldAssertion: SameFieldAssertionStatus;
  evidence: IosCredentialEntryDiagnosticEvidence;
};

export type IosCredentialEntryDiagnosticResult = {
  kind: typeof iosCredentialEntryDiagnosticKind;
  schemaVersion: typeof iosCredentialEntryDiagnosticSchemaVersion;
  status: 'observed' | 'failed' | 'blocked';
  nativeQualification: 'Pending';
  publicPromotionEligible: false;
  credentialsRetained: false;
  rawHierarchyValuesRetained: false;
  observedStages: readonly SnapshotDiagnostic[];
  reloadObservation: 'observed' | 'not-observed' | 'unknown';
  failure: {
    stage: IosCredentialEntryDiagnosticStage;
    reason:
      | 'action-failed'
      | 'action-blocked'
      | 'exact-same-field-assertion-failed'
      | 'exact-same-field-assertion-not-recorded'
      | 'diagnostic-stage-not-captured';
  } | null;
};

const allowedSnapshotKeys = new Set([
  'stage',
  'sequence',
  'hierarchy',
  'keyboard',
  'appBoundary',
  'action',
  'evidence',
  'sameFieldAssertion',
]);
const allowedActionKeys = new Set([
  'kind',
  'status',
  'selector',
  'retryCount',
  'coordinatesUsed',
  'optionalAssertionsUsed',
  'credentialValueRecorded',
]);
const allowedEvidenceKeys = new Set([
  'hierarchySha256',
  'screenshotSha256',
  'commandReceiptSha256',
]);
const allowedSameFieldAssertionKeys = new Set(['selector', 'status', 'exactValueBound']);
const sha256Pattern = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireExactKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${label} contains unapproved or sensitive metadata`);
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new Error(`${label} is invalid`);
  return value as T;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !sha256Pattern.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function requireSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error('Diagnostic sequence must be a non-negative safe integer');
  return Number(value);
}

function readChildren(value: Record<string, unknown>, label: string): readonly unknown[] {
  if (value.children === undefined) return [];
  if (!Array.isArray(value.children)) throw new Error(`${label}.children must be an array`);
  return value.children;
}

function readAttributes(value: Record<string, unknown>, label: string): Record<string, unknown> {
  if (value.attributes === undefined) return {};
  if (!isRecord(value.attributes)) throw new Error(`${label}.attributes must be an object`);
  return value.attributes;
}

type NativeNode = { attributes: Record<string, unknown> };

function flattenHierarchy(value: unknown): readonly NativeNode[] {
  const nodes: NativeNode[] = [];
  const active = new Set<object>();
  const visit = (candidate: unknown, label: string): void => {
    const node = requireRecord(candidate, label);
    if (active.has(node)) throw new Error('Native hierarchy contains a cycle');
    active.add(node);
    nodes.push({ attributes: readAttributes(node, label) });
    for (const [index, child] of readChildren(node, label).entries())
      visit(child, `${label}.children[${index}]`);
    active.delete(node);
  };
  visit(value, 'Native hierarchy root');
  return nodes;
}

function matchingNode(nodes: readonly NativeNode[], selector: string): NativeNode | undefined {
  return nodes.find((node) => node.attributes['resource-id'] === selector);
}

function booleanAttribute(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function focusState(node: NativeNode | undefined): FocusState {
  if (!node) return 'unknown';
  const values = ['focused', 'focus', 'has-focus']
    .map((key) => booleanAttribute(node.attributes[key]))
    .filter((value): value is boolean => value !== undefined);
  if (values.length === 0) return 'unknown';
  if (values.every((value) => value === true)) return 'focused';
  if (values.every((value) => value === false)) return 'not-focused';
  return 'unknown';
}

function boundsState(node: NativeNode | undefined): BoundsState {
  if (!node) return null;
  const value = node.attributes.bounds;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !boundsPattern.test(value))
    throw new Error('Native target bounds are malformed');
  return value;
}

function valueState(node: NativeNode | undefined): ValueState {
  if (!node) return 'absent';
  const values = ['text', 'value', 'input-text']
    .filter((key) => Object.hasOwn(node.attributes, key))
    .map((key) => node.attributes[key]);
  if (values.length === 0) return 'unknown';
  if (values.some((value) => typeof value !== 'string')) return 'unknown';
  return values.some((value) => (value as string).trim().length > 0) ? 'nonempty' : 'empty';
}

function fieldDiagnostic(nodes: readonly NativeNode[], selector: string): FieldDiagnostic {
  const node = matchingNode(nodes, selector);
  return {
    presence: node ? 'present' : 'absent',
    value: valueState(node),
    focus: focusState(node),
    bounds: boundsState(node),
  };
}

function unavailableFieldDiagnostic(): FieldDiagnostic {
  return {
    presence: 'unknown',
    value: 'unknown',
    focus: 'unknown',
    bounds: null,
  };
}

function requireAction(
  value: unknown,
  stage: IosCredentialEntryDiagnosticStage,
): IosCredentialEntryDiagnosticAction {
  const action = requireRecord(value, `${stage} action`);
  requireExactKeys(action, allowedActionKeys, `${stage} action`);
  const kind = requireOneOf(
    action.kind,
    ['observation', 'tap-email', 'input-email'],
    `${stage} action kind`,
  );
  const status = requireOneOf(
    action.status,
    ['completed', 'failed', 'blocked'],
    `${stage} action status`,
  );
  if (typeof action.selector !== 'string' && action.selector !== null)
    throw new Error(`${stage} action selector is invalid`);
  if (!Number.isSafeInteger(action.retryCount) || action.retryCount !== 0)
    throw new Error(`${stage} diagnostic does not permit retries`);
  if (action.coordinatesUsed !== false)
    throw new Error(`${stage} diagnostic does not permit coordinates`);
  if (action.optionalAssertionsUsed !== false)
    throw new Error(`${stage} diagnostic does not permit optional assertions`);
  if (action.credentialValueRecorded !== false)
    throw new Error(`${stage} diagnostic cannot retain credential values`);
  return {
    kind,
    status,
    selector: action.selector,
    retryCount: 0,
    coordinatesUsed: false,
    optionalAssertionsUsed: false,
    credentialValueRecorded: false,
  };
}

function requireEvidence(
  value: unknown,
  stage: IosCredentialEntryDiagnosticStage,
): IosCredentialEntryDiagnosticEvidence {
  const evidence = requireRecord(value, `${stage} evidence`);
  requireExactKeys(evidence, allowedEvidenceKeys, `${stage} evidence`);
  const hierarchySha256 =
    evidence.hierarchySha256 === null
      ? null
      : requireSha256(evidence.hierarchySha256, `${stage} hierarchySha256`);
  const screenshotSha256 =
    evidence.screenshotSha256 === null
      ? null
      : requireSha256(evidence.screenshotSha256, `${stage} screenshotSha256`);
  return {
    hierarchySha256,
    screenshotSha256,
    commandReceiptSha256: requireSha256(
      evidence.commandReceiptSha256,
      `${stage} commandReceiptSha256`,
    ),
  };
}

function requireSameFieldAssertion(
  value: unknown,
  stage: IosCredentialEntryDiagnosticStage,
): {
  selector: typeof iosCredentialEntryDiagnosticSelectors.email;
  status: Exclude<SameFieldAssertionStatus, 'not-run'>;
  exactValueBound: true;
} {
  const assertion = requireRecord(value, `${stage} same-field assertion`);
  requireExactKeys(assertion, allowedSameFieldAssertionKeys, `${stage} same-field assertion`);
  if (assertion.selector !== iosCredentialEntryDiagnosticSelectors.email)
    throw new Error(`${stage} same-field assertion selector is not exact`);
  if (assertion.exactValueBound !== true)
    throw new Error(`${stage} same-field assertion is not bound to the exact input`);
  return {
    selector: iosCredentialEntryDiagnosticSelectors.email,
    status: requireOneOf(
      assertion.status,
      ['passed', 'failed'],
      `${stage} same-field assertion status`,
    ),
    exactValueBound: true,
  };
}

function requireSnapshot(value: unknown, index: number): IosCredentialEntryDiagnosticSnapshot {
  const snapshot = requireRecord(value, `Diagnostic snapshot ${index}`);
  requireExactKeys(snapshot, allowedSnapshotKeys, `Diagnostic snapshot ${index}`);
  const stage = requireOneOf(
    snapshot.stage,
    iosCredentialEntryDiagnosticStages,
    `Diagnostic snapshot ${index} stage`,
  );
  const keyboard = requireOneOf(
    snapshot.keyboard,
    ['visible', 'hidden', 'unknown'],
    `${stage} keyboard`,
  );
  const appBoundary = requireOneOf(
    snapshot.appBoundary,
    ['same-app-instance', 'relaunch-observed', 'unknown'],
    `${stage} app boundary`,
  );
  const action = requireAction(snapshot.action, stage);
  const evidence = requireEvidence(snapshot.evidence, stage);
  if (
    action.status === 'completed' &&
    (evidence.hierarchySha256 === null || evidence.screenshotSha256 === null)
  )
    throw new Error(`${stage} completed action requires hierarchy and screenshot evidence`);
  let sameFieldAssertion: IosCredentialEntryDiagnosticSnapshot['sameFieldAssertion'];
  if (snapshot.sameFieldAssertion !== undefined)
    sameFieldAssertion = requireSameFieldAssertion(snapshot.sameFieldAssertion, stage);
  return {
    stage,
    sequence: requireSequence(snapshot.sequence),
    hierarchy: snapshot.hierarchy,
    keyboard,
    appBoundary,
    action,
    evidence,
    ...(sameFieldAssertion ? { sameFieldAssertion } : {}),
  };
}

function expectedAction(stage: IosCredentialEntryDiagnosticStage): {
  kind: IosCredentialEntryDiagnosticActionKind;
  selector: string | null;
} {
  if (stage === 'entry') return { kind: 'observation', selector: null };
  return {
    kind: stage === 'email-after-tap' ? 'tap-email' : 'input-email',
    selector: iosCredentialEntryDiagnosticSelectors.email,
  };
}

function diagnosticForSnapshot(snapshot: IosCredentialEntryDiagnosticSnapshot): SnapshotDiagnostic {
  const hierarchyAvailable = snapshot.hierarchy !== null && snapshot.hierarchy !== undefined;
  const nodes = hierarchyAvailable ? flattenHierarchy(snapshot.hierarchy) : [];
  const expected = expectedAction(snapshot.stage);
  if (snapshot.action.kind !== expected.kind || snapshot.action.selector !== expected.selector)
    throw new Error(`${snapshot.stage} action does not match the diagnostic stage`);
  if (snapshot.stage !== 'email-after-input' && snapshot.sameFieldAssertion !== undefined)
    throw new Error(`${snapshot.stage} cannot carry a same-field assertion`);
  const email = hierarchyAvailable
    ? fieldDiagnostic(nodes, iosCredentialEntryDiagnosticSelectors.email)
    : unavailableFieldDiagnostic();
  const password = hierarchyAvailable
    ? fieldDiagnostic(nodes, iosCredentialEntryDiagnosticSelectors.password)
    : unavailableFieldDiagnostic();
  const submit: PresenceState = hierarchyAvailable
    ? matchingNode(nodes, iosCredentialEntryDiagnosticSelectors.submit)
      ? 'present'
      : 'absent'
    : 'unknown';
  return {
    stage: snapshot.stage,
    sequence: snapshot.sequence,
    email,
    password,
    submit,
    keyboard: snapshot.keyboard,
    appBoundary: snapshot.appBoundary,
    actionStatus: snapshot.action.status,
    sameFieldAssertion: snapshot.sameFieldAssertion?.status ?? 'not-run',
    evidence: snapshot.evidence,
  };
}

function failureForSnapshot(
  snapshot: SnapshotDiagnostic,
): IosCredentialEntryDiagnosticResult['failure'] {
  if (snapshot.sameFieldAssertion === 'failed')
    return {
      stage: snapshot.stage,
      reason: 'exact-same-field-assertion-failed',
    };
  if (snapshot.actionStatus === 'failed') return { stage: snapshot.stage, reason: 'action-failed' };
  if (snapshot.actionStatus === 'blocked')
    return { stage: snapshot.stage, reason: 'action-blocked' };
  if (snapshot.stage === 'email-after-input' && snapshot.sameFieldAssertion === 'not-run')
    return {
      stage: snapshot.stage,
      reason: 'exact-same-field-assertion-not-recorded',
    };
  return null;
}

function reloadObservation(
  snapshots: readonly SnapshotDiagnostic[],
): IosCredentialEntryDiagnosticResult['reloadObservation'] {
  if (snapshots.some((snapshot) => snapshot.appBoundary === 'relaunch-observed')) return 'observed';
  if (snapshots.every((snapshot) => snapshot.appBoundary === 'same-app-instance'))
    return 'not-observed';
  return 'unknown';
}

/**
 * Projects private hierarchy/keyboard observations into redacted diagnostics.
 * It deliberately never returns hierarchy nodes, text, paths, or credential values.
 */
export function collectIosCredentialEntryDiagnostic(
  input: readonly IosCredentialEntryDiagnosticSnapshot[],
): IosCredentialEntryDiagnosticResult {
  if (input.length === 0) throw new Error('Credential diagnostic requires at least one snapshot');
  const snapshots = input.map((snapshot, index) => requireSnapshot(snapshot, index));
  const observed: SnapshotDiagnostic[] = [];
  let failure: IosCredentialEntryDiagnosticResult['failure'] = null;
  for (const [index, snapshot] of snapshots.entries()) {
    if (snapshot.sequence !== index)
      throw new Error('Credential diagnostic sequence must be contiguous and ordered');
    if (snapshot.stage !== iosCredentialEntryDiagnosticStages[index])
      throw new Error('Credential diagnostic stages must be contiguous and ordered');
    const projection = diagnosticForSnapshot(snapshot);
    observed.push(projection);
    const snapshotFailure = failureForSnapshot(projection);
    if (snapshotFailure) {
      failure = snapshotFailure;
      if (index !== snapshots.length - 1)
        throw new Error('Credential diagnostic cannot continue after a failed stage');
      break;
    }
  }
  if (!failure && observed.length !== iosCredentialEntryDiagnosticStages.length)
    failure = {
      stage: iosCredentialEntryDiagnosticStages[observed.length],
      reason: 'diagnostic-stage-not-captured',
    };
  let status: IosCredentialEntryDiagnosticResult['status'] = 'observed';
  if (failure)
    status =
      failure.reason === 'action-blocked' ||
      failure.reason === 'diagnostic-stage-not-captured' ||
      failure.reason === 'exact-same-field-assertion-not-recorded'
        ? 'blocked'
        : 'failed';
  return {
    kind: iosCredentialEntryDiagnosticKind,
    schemaVersion: iosCredentialEntryDiagnosticSchemaVersion,
    status,
    nativeQualification: 'Pending',
    publicPromotionEligible: false,
    credentialsRetained: false,
    rawHierarchyValuesRetained: false,
    observedStages: observed,
    reloadObservation: reloadObservation(observed),
    failure,
  };
}
