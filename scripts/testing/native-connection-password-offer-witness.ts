import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const nativeConnectionPasswordOfferWitnessKind =
  'private-native-connection-password-offer-witness';
export const nativeConnectionPasswordOfferWitnessSchemaVersion = 1 as const;
export const nativeConnectionPasswordOfferPromptSelector = '^Save Password\\?$';
export const nativeConnectionPasswordOfferDismissSelector = '^Not Now$';
export const nativeConnectionPasswordOfferMaxCommandMetadataBytes = 8 * 1024 * 1024;
export const nativeConnectionPasswordOfferMaxScreenshotBytes = 16 * 1024 * 1024;

const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const expectedStepKinds = [
  'prompt-visible',
  'prompt-screenshot',
  'dismiss-visible-enabled',
  'dismiss-animation-settled',
  'dismiss-tap',
  'prompt-absent',
  'home-visible',
] as const;

export type NativeConnectionPasswordOfferStepKind = (typeof expectedStepKinds)[number];
export type NativeConnectionPasswordOfferActor = 'coach' | 'student';

export type NativeConnectionPasswordOfferCommandRecord = {
  command: Record<string, unknown>;
  metadata: {
    status: 'COMPLETED';
    sequenceNumber: number;
    evaluatedCommand?: Record<string, unknown>;
  };
};

export type NativeConnectionPasswordOfferWitness = {
  kind: typeof nativeConnectionPasswordOfferWitnessKind;
  schemaVersion: typeof nativeConnectionPasswordOfferWitnessSchemaVersion;
  actor: NativeConnectionPasswordOfferActor;
  flowLabel: string;
  actorAuthUid: string;
  signInRequestOrdinal: number;
  authRequestId: number;
  commandMetadataPath: string;
  commandMetadataSha256: string;
  commandMetadataBytes: number;
  promptScreenshotPath: string;
  promptScreenshotSha256: string;
  promptScreenshotBytes: number;
  promptSelector: typeof nativeConnectionPasswordOfferPromptSelector;
  dismissSelector: typeof nativeConnectionPasswordOfferDismissSelector;
  dismissEnabled: true;
  retryTapIfNoChange: true;
  promptAbsenceAsserted: true;
  steps: readonly NativeConnectionPasswordOfferStepKind[];
  nativePassingCases: 0;
};

export type NativeConnectionPasswordOfferWitnessExpectation = {
  artifactRoot: string;
  actor?: NativeConnectionPasswordOfferActor;
  flowLabel?: string;
  actorAuthUid?: string;
  signInRequestOrdinal?: number;
  authRequestId?: number;
  homeSelector: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label} must be a non-empty string`);
  return value;
}

function safeLabel(value: unknown, label: string): string {
  const result = nonEmptyString(value, label);
  if (!/^[a-z0-9-]+$/.test(result)) throw new Error(`${label} has unsafe characters`);
  return result;
}

function safeSelector(value: unknown, label: string): string {
  const result = nonEmptyString(value, label);
  if (!/^[a-zA-Z0-9._-]+$/.test(result)) throw new Error(`${label} has unsafe characters`);
  return result;
}

export function nativeConnectionPasswordOfferCommandMetadataPath(flowLabel: unknown): string {
  return `${safeLabel(flowLabel, 'flowLabel')}-password-offer-commands.json`;
}

export function nativeConnectionPasswordOfferPromptScreenshotPath(flowLabel: unknown): string {
  return `${safeLabel(flowLabel, 'flowLabel')}-password-offer.png`;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireRelativeArtifactPath(value: unknown, suffix: string, label: string): string {
  const result = nonEmptyString(value, label);
  if (path.isAbsolute(result) || result.includes('\0') || result.split('/').includes('..'))
    throw new Error(`${label} must be relative to the artifact root`);
  if (!result.endsWith(suffix)) throw new Error(`${label} has an invalid suffix`);
  return result;
}

function artifactTarget(root: string, relative: string, label: string): string {
  const resolvedRoot = path.resolve(nonEmptyString(root, 'artifactRoot'));
  const target = path.resolve(resolvedRoot, relative);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`))
    throw new Error(`${label} escapes the artifact root`);
  return target;
}

function requirePrivateOwnerAndMode(
  info: { mode: number; uid: number },
  mode: number,
  label: string,
): void {
  const uid = process.getuid?.();
  if (uid !== undefined && info.uid !== uid)
    throw new Error(`${label} is not owned by this process`);
  if ((info.mode & 0o777) !== mode) throw new Error(`${label} has an unsafe private mode`);
}

async function requirePrivateArtifactRoot(value: string): Promise<string> {
  const resolvedRoot = path.resolve(nonEmptyString(value, 'artifactRoot'));
  const info = await lstat(resolvedRoot);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Connection password-offer artifact root is not a regular directory');
  requirePrivateOwnerAndMode(info, privateDirectoryMode, 'Connection password-offer artifact root');
  if ((await realpath(resolvedRoot)) !== resolvedRoot)
    throw new Error('Connection password-offer artifact root is not canonical');
  return resolvedRoot;
}

async function requirePrivateArtifactParents(
  resolvedRoot: string,
  target: string,
  label: string,
): Promise<void> {
  const relative = path.relative(resolvedRoot, target);
  const parentParts = relative.split(path.sep).filter(Boolean).slice(0, -1);
  let current = resolvedRoot;
  for (const part of parentParts) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`${label} has an unsafe parent directory`);
    requirePrivateOwnerAndMode(info, privateDirectoryMode, `${label} parent directory`);
    if ((await realpath(current)) !== current)
      throw new Error(`${label} parent directory is not canonical`);
  }
}

function requireSafeSelector(value: unknown, expected: string, label: string): void {
  if (value !== expected) throw new Error(`${label} is not the exact required selector`);
}

function rejectOptionalCommandFields(
  value: unknown,
  label: string,
  seen = new Set<object>(),
): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectOptionalCommandFields(item, `${label}[${index}]`, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'optional' && child === true)
      throw new Error(`${label}.${key} must be false for a mandatory witness command`);
    rejectOptionalCommandFields(child, `${label}.${key}`, seen);
  }
}

function requireMandatoryCommandBody(value: unknown, label: string): Record<string, unknown> {
  const body = record(value, label);
  if (body.optional !== false)
    throw new Error(`${label}.optional must be false for a mandatory witness command`);
  rejectOptionalCommandFields(body, label);
  return body;
}

function commandStatus(value: Record<string, unknown>): void {
  const metadata = record(value.metadata, 'Maestro command metadata');
  if (metadata.status !== 'COMPLETED')
    throw new Error('Connection password-offer witness contains an incomplete command');
  if (Object.hasOwn(metadata, 'optional'))
    throw new Error('Connection password-offer command metadata cannot contain optional');
  const command = record(value.command, 'Maestro command');
  rejectOptionalCommandFields(command, 'Maestro command');
  if (metadata.evaluatedCommand !== undefined)
    rejectOptionalCommandFields(metadata.evaluatedCommand, 'Maestro evaluated command');
  if (!Number.isSafeInteger(metadata.sequenceNumber) || Number(metadata.sequenceNumber) < 0)
    throw new Error('Connection password-offer command sequence is invalid');
}

function selectorValue(condition: unknown): Record<string, unknown> {
  return requireMandatoryCommandBody(condition, 'Maestro selector condition');
}

function visibleCondition(command: Record<string, unknown>): Record<string, unknown> | null {
  const condition = command.assertConditionCommand;
  if (condition === undefined) return null;
  const body = requireMandatoryCommandBody(condition, 'Maestro assert condition command');
  const visible = body.condition;
  const conditionRecord = record(visible, 'Maestro assert condition');
  if (conditionRecord.visible !== undefined) return selectorValue(conditionRecord.visible);
  return null;
}

function notVisibleCondition(command: Record<string, unknown>): Record<string, unknown> | null {
  const condition = command.assertConditionCommand;
  if (condition === undefined) return null;
  const body = requireMandatoryCommandBody(condition, 'Maestro assert condition command');
  const conditionRecord = record(body.condition, 'Maestro assert condition');
  if (conditionRecord.notVisible !== undefined) return selectorValue(conditionRecord.notVisible);
  return null;
}

function screenshotName(command: Record<string, unknown>): string {
  const body = requireMandatoryCommandBody(
    command.takeScreenshotCommand,
    'Maestro screenshot command',
  );
  const name = body.path ?? body.name;
  return nonEmptyString(name, 'Maestro screenshot name');
}

function classifyCommand(
  command: Record<string, unknown>,
  homeSelector: string,
): NativeConnectionPasswordOfferStepKind | null {
  const visible = visibleCondition(command);
  if (visible) {
    if (visible.textRegex === nativeConnectionPasswordOfferPromptSelector) return 'prompt-visible';
    if (
      visible.textRegex === nativeConnectionPasswordOfferDismissSelector &&
      visible.enabled === true
    )
      return 'dismiss-visible-enabled';
    if (visible.idRegex === homeSelector) return 'home-visible';
  }
  const notVisible = notVisibleCondition(command);
  if (notVisible?.textRegex === nativeConnectionPasswordOfferPromptSelector) return 'prompt-absent';
  if (command.waitForAnimationToEndCommand !== undefined) {
    const wait = requireMandatoryCommandBody(
      command.waitForAnimationToEndCommand,
      'Maestro animation wait command',
    );
    if (wait.timeout !== '5000')
      throw new Error('Connection password-offer animation wait must be bounded to 5000ms');
    return 'dismiss-animation-settled';
  }
  if (command.takeScreenshotCommand !== undefined) return 'prompt-screenshot';
  const tap = command.tapOnElement;
  if (tap !== undefined) {
    const tapBody = requireMandatoryCommandBody(tap, 'Maestro tap command');
    const selector = selectorValue(tapBody.selector);
    if (
      selector.textRegex === nativeConnectionPasswordOfferDismissSelector &&
      selector.enabled === true &&
      tapBody.retryIfNoChange === true
    )
      return 'dismiss-tap';
  }
  return null;
}

function requireCommandMetadataRecords(
  value: unknown,
): NativeConnectionPasswordOfferCommandRecord[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('Connection password-offer command metadata must be a non-empty array');
  const records = value.map((raw, index) => {
    const row = record(raw, `Maestro command ${index}`);
    commandStatus(row);
    const command = record(row.command, `Maestro command ${index}.command`);
    const metadata = record(row.metadata, `Maestro command ${index}.metadata`);
    return {
      command,
      metadata: {
        status: 'COMPLETED' as const,
        sequenceNumber: Number(metadata.sequenceNumber),
        ...(metadata.evaluatedCommand === undefined
          ? {}
          : { evaluatedCommand: record(metadata.evaluatedCommand, 'Maestro evaluated command') }),
      },
    };
  });
  const sequenceNumbers = records.map((row) => row.metadata.sequenceNumber);
  if (new Set(sequenceNumbers).size !== sequenceNumbers.length)
    throw new Error('Connection password-offer command sequence is duplicated');
  return [...records].sort(
    (left, right) => left.metadata.sequenceNumber - right.metadata.sequenceNumber,
  );
}

export function requireNativeConnectionPasswordOfferCommandSequence(
  value: unknown,
  options: { homeSelector: string; promptScreenshotName?: string },
): NativeConnectionPasswordOfferStepKind[] {
  const homeSelector = safeSelector(options.homeSelector, 'homeSelector');
  const records = requireCommandMetadataRecords(value);
  const screenshots = records
    .map((row) => row.metadata.evaluatedCommand ?? row.command)
    .filter((command) => command.takeScreenshotCommand !== undefined);
  if (
    options.promptScreenshotName !== undefined &&
    (screenshots.length !== 1 ||
      path.basename(screenshotName(screenshots[0])).replace(/\.png$/i, '') !==
        safeLabel(options.promptScreenshotName, 'promptScreenshotName'))
  )
    throw new Error('Connection password-offer screenshot command is not bound to the witness');
  // Credential entry runs in the same flow before the offer and is not offer
  // evidence (the iOS email retry carries its own animation wait), so steps are
  // classified from the first prompt-visible assertion onward.
  const promptIndex = records.findIndex(
    (row) =>
      visibleCondition(row.metadata.evaluatedCommand ?? row.command)?.textRegex ===
      nativeConnectionPasswordOfferPromptSelector,
  );
  const steps = records
    .slice(Math.max(promptIndex, 0))
    .map((row) => classifyCommand(row.metadata.evaluatedCommand ?? row.command, homeSelector))
    .filter((step): step is NativeConnectionPasswordOfferStepKind => step !== null);
  if (steps.filter((step) => step === 'prompt-screenshot').length !== 1)
    throw new Error('Connection password-offer witness requires one prompt screenshot command');
  if (steps.length !== expectedStepKinds.length)
    throw new Error('Connection password-offer command sequence has unexpected evidence steps');
  if (steps.some((step, index) => step !== expectedStepKinds[index]))
    throw new Error('Connection password-offer command sequence is missing or reordered');
  return steps;
}

export function buildIosConnectionPasswordOfferActions(
  credentialActions: unknown,
  promptScreenshotName: unknown,
  homeSelector: unknown,
): string {
  const credentials = nonEmptyString(credentialActions, 'credentialActions');
  const screenshot = safeLabel(promptScreenshotName, 'promptScreenshotName');
  const home = safeSelector(homeSelector, 'homeSelector');
  if (credentials.includes('takeScreenshot') || credentials.includes('Save Password'))
    throw new Error('credentialActions must not contain password-offer actions');
  return [
    credentials,
    '- extendedWaitUntil:',
    '    visible:',
    `      text: ${JSON.stringify(nativeConnectionPasswordOfferPromptSelector)}`,
    '    timeout: 30000',
    `- takeScreenshot: ${JSON.stringify(screenshot)}`,
    '- extendedWaitUntil:',
    '    visible:',
    `      text: ${JSON.stringify(nativeConnectionPasswordOfferDismissSelector)}`,
    '      enabled: true',
    '    timeout: 30000',
    '- waitForAnimationToEnd:',
    '    timeout: "5000"',
    '- tapOn:',
    `    text: ${JSON.stringify(nativeConnectionPasswordOfferDismissSelector)}`,
    '    enabled: true',
    '    retryTapIfNoChange: true',
    '    waitToSettleTimeoutMs: 5000',
    '- extendedWaitUntil:',
    '    notVisible:',
    `      text: ${JSON.stringify(nativeConnectionPasswordOfferPromptSelector)}`,
    '    timeout: 30000',
    '- extendedWaitUntil:',
    '    visible:',
    `      id: ${JSON.stringify(home)}`,
    '    timeout: 90000',
  ].join('\n');
}

function requireWitnessShape(value: unknown): NativeConnectionPasswordOfferWitness {
  const row = record(value, 'Connection password-offer witness');
  if (Object.hasOwn(row, 'hierarchyPath'))
    throw new Error('Password-offer witness cannot fabricate a hierarchy path');
  const allowedKeys = new Set([
    'kind',
    'schemaVersion',
    'actor',
    'flowLabel',
    'actorAuthUid',
    'signInRequestOrdinal',
    'authRequestId',
    'commandMetadataPath',
    'commandMetadataSha256',
    'commandMetadataBytes',
    'promptScreenshotPath',
    'promptScreenshotSha256',
    'promptScreenshotBytes',
    'promptSelector',
    'dismissSelector',
    'dismissEnabled',
    'retryTapIfNoChange',
    'promptAbsenceAsserted',
    'steps',
    'nativePassingCases',
  ]);
  for (const key of Object.keys(row))
    if (!allowedKeys.has(key))
      throw new Error(`Connection password-offer witness field is unknown: ${key}`);
  if (row.kind !== nativeConnectionPasswordOfferWitnessKind)
    throw new Error('Connection password-offer witness kind is invalid');
  if (row.schemaVersion !== nativeConnectionPasswordOfferWitnessSchemaVersion)
    throw new Error('Connection password-offer witness schema version is invalid');
  if (row.actor !== 'coach' && row.actor !== 'student')
    throw new Error('Connection password-offer witness actor is invalid');
  const flowLabel = safeLabel(row.flowLabel, 'flowLabel');
  const actorAuthUid = nonEmptyString(row.actorAuthUid, 'actorAuthUid');
  for (const [key, valueToCheck] of [
    ['signInRequestOrdinal', row.signInRequestOrdinal],
    ['authRequestId', row.authRequestId],
    ['commandMetadataBytes', row.commandMetadataBytes],
    ['promptScreenshotBytes', row.promptScreenshotBytes],
  ] as const) {
    if (!Number.isSafeInteger(valueToCheck) || Number(valueToCheck) <= 0)
      throw new Error(`Connection password-offer witness ${key} is invalid`);
  }
  const commandMetadataPath = requireRelativeArtifactPath(
    row.commandMetadataPath,
    '.json',
    'commandMetadataPath',
  );
  const promptScreenshotPath = requireRelativeArtifactPath(
    row.promptScreenshotPath,
    '.png',
    'promptScreenshotPath',
  );
  if (
    path.basename(commandMetadataPath) !==
    nativeConnectionPasswordOfferCommandMetadataPath(flowLabel)
  )
    throw new Error('Connection password-offer command metadata is not bound to the flow label');
  if (
    path.basename(promptScreenshotPath) !==
    nativeConnectionPasswordOfferPromptScreenshotPath(flowLabel)
  )
    throw new Error('Connection password-offer screenshot is not bound to the flow label');
  if (!/^[a-f0-9]{64}$/.test(String(row.commandMetadataSha256)))
    throw new Error('Connection password-offer command hash is invalid');
  if (!/^[a-f0-9]{64}$/.test(String(row.promptScreenshotSha256)))
    throw new Error('Connection password-offer screenshot hash is invalid');
  requireSafeSelector(
    row.promptSelector,
    nativeConnectionPasswordOfferPromptSelector,
    'promptSelector',
  );
  requireSafeSelector(
    row.dismissSelector,
    nativeConnectionPasswordOfferDismissSelector,
    'dismissSelector',
  );
  if (row.dismissEnabled !== true || row.retryTapIfNoChange !== true)
    throw new Error('Connection password-offer dismissal must be enabled and bounded');
  if (row.promptAbsenceAsserted !== true)
    throw new Error('Connection password-offer prompt absence was not asserted');
  if (row.nativePassingCases !== 0)
    throw new Error('Password-offer setup witness cannot grant native passing cases');
  if (!Array.isArray(row.steps) || row.steps.length !== expectedStepKinds.length)
    throw new Error('Connection password-offer witness steps are incomplete');
  if (row.steps.some((step, index) => step !== expectedStepKinds[index]))
    throw new Error('Connection password-offer witness steps are reordered');
  return {
    kind: nativeConnectionPasswordOfferWitnessKind,
    schemaVersion: nativeConnectionPasswordOfferWitnessSchemaVersion,
    actor: row.actor,
    flowLabel,
    actorAuthUid,
    signInRequestOrdinal: Number(row.signInRequestOrdinal),
    authRequestId: Number(row.authRequestId),
    commandMetadataPath,
    commandMetadataSha256: String(row.commandMetadataSha256),
    commandMetadataBytes: Number(row.commandMetadataBytes),
    promptScreenshotPath,
    promptScreenshotSha256: String(row.promptScreenshotSha256),
    promptScreenshotBytes: Number(row.promptScreenshotBytes),
    promptSelector: nativeConnectionPasswordOfferPromptSelector,
    dismissSelector: nativeConnectionPasswordOfferDismissSelector,
    dismissEnabled: true,
    retryTapIfNoChange: true,
    promptAbsenceAsserted: true,
    steps: [...expectedStepKinds],
    nativePassingCases: 0,
  };
}

async function requirePrivateFile(
  artifactRoot: string,
  relative: string,
  suffix: string,
  expectedSha256: string,
  expectedBytes: number,
  label: string,
): Promise<Buffer> {
  const safeRelative = requireRelativeArtifactPath(relative, suffix, label);
  const resolvedRoot = await requirePrivateArtifactRoot(artifactRoot);
  const target = artifactTarget(resolvedRoot, safeRelative, label);
  await requirePrivateArtifactParents(resolvedRoot, target, label);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} is not a regular file`);
  requirePrivateOwnerAndMode(info, privateFileMode, label);
  const maxBytes =
    suffix === '.json'
      ? nativeConnectionPasswordOfferMaxCommandMetadataBytes
      : nativeConnectionPasswordOfferMaxScreenshotBytes;
  if (expectedBytes > maxBytes || info.size > maxBytes)
    throw new Error(`${label} exceeds its bounded size`);
  if (info.size !== expectedBytes) throw new Error(`${label} byte count changed`);
  if ((await realpath(target)) !== target) throw new Error(`${label} is not canonical`);
  const bytes = await readFile(target);
  if (bytes.length !== expectedBytes) throw new Error(`${label} byte count changed`);
  if (sha256(bytes) !== expectedSha256) throw new Error(`${label} hash changed`);
  if (suffix === '.png' && !bytes.subarray(0, pngSignature.length).equals(pngSignature))
    throw new Error(`${label} does not have a PNG signature`);
  return bytes;
}

export async function requireNativeConnectionPasswordOfferWitness(
  value: unknown,
  options: NativeConnectionPasswordOfferWitnessExpectation,
): Promise<NativeConnectionPasswordOfferWitness> {
  const witness = requireWitnessShape(value);
  if (options.actor !== undefined && witness.actor !== options.actor)
    throw new Error('Connection password-offer witness actor differs from expected actor');
  if (options.flowLabel !== undefined && witness.flowLabel !== options.flowLabel)
    throw new Error('Connection password-offer witness flow label differs from expected label');
  if (options.actorAuthUid !== undefined && witness.actorAuthUid !== options.actorAuthUid)
    throw new Error('Connection password-offer witness principal differs from expected actor');
  if (
    options.signInRequestOrdinal !== undefined &&
    witness.signInRequestOrdinal !== options.signInRequestOrdinal
  )
    throw new Error('Connection password-offer witness request ordinal differs from expected');
  if (options.authRequestId !== undefined && witness.authRequestId !== options.authRequestId)
    throw new Error('Connection password-offer witness auth request differs from expected');
  const commandBytes = await requirePrivateFile(
    options.artifactRoot,
    witness.commandMetadataPath,
    '.json',
    witness.commandMetadataSha256,
    witness.commandMetadataBytes,
    'Connection password-offer command metadata',
  );
  requireNativeConnectionPasswordOfferCommandSequence(JSON.parse(commandBytes.toString('utf8')), {
    homeSelector: options.homeSelector,
    promptScreenshotName: path.basename(witness.promptScreenshotPath, '.png'),
  });
  await requirePrivateFile(
    options.artifactRoot,
    witness.promptScreenshotPath,
    '.png',
    witness.promptScreenshotSha256,
    witness.promptScreenshotBytes,
    'Connection password-offer prompt screenshot',
  );
  return witness;
}

export async function requireNativeConnectionPasswordOfferWitnesses(
  value: unknown,
  options: {
    artifactRoot: string;
    expected: readonly {
      actor: NativeConnectionPasswordOfferActor;
      flowLabel: string;
      actorAuthUid: string;
      signInRequestOrdinal: number;
      authRequestId: number;
      homeSelector: string;
    }[];
  },
): Promise<NativeConnectionPasswordOfferWitness[]> {
  if (!Array.isArray(value) || value.length !== options.expected.length)
    throw new Error('Connection password-offer witness count is incomplete');
  const witnesses: NativeConnectionPasswordOfferWitness[] = [];
  for (const [index, expectation] of options.expected.entries())
    witnesses.push(
      await requireNativeConnectionPasswordOfferWitness(value[index], {
        artifactRoot: options.artifactRoot,
        ...expectation,
      }),
    );
  return witnesses;
}
