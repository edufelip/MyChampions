import { createHash } from 'node:crypto';
import path from 'node:path';

const sessionPostTapEvidenceMaxBytes = 8 * 1024 * 1024;

export const sessionSignOutPostTapActions = [
  '- scrollUntilVisible:',
  '    element:',
  '      id: settings.account.signOutCta',
  '    direction: DOWN',
  '    timeout: 30000',
  '- tapOn:',
  '    id: settings.account.signOutCta',
].join('\n');

type SessionPostTapWriteOptions = {
  mode?: number;
  flag?: string;
};

type SessionPostTapRun = (
  label: string,
  command: string,
  argv: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) => Promise<string>;

type SessionPostTapExecute = (
  label: string,
  command: string,
  argv: string[],
  options?: { timeout?: number; maxBuffer?: number },
) => Promise<unknown>;

type SessionPostTapEvidenceReader = (
  label: string,
  relativePath: string,
  privateRecord?: boolean,
) => Buffer;

export type SessionPostTapDiagnosticIo = {
  output: string;
  bundleId: string;
  deviceUdid: string;
  signal: AbortSignal;
  requireBooted: (label: string) => Promise<void>;
  writeText: (
    label: string,
    file: string,
    data: string | Uint8Array,
    options?: SessionPostTapWriteOptions,
  ) => Promise<void>;
  run: SessionPostTapRun;
  execute: SessionPostTapExecute;
  readEvidence: SessionPostTapEvidenceReader;
  parseHierarchy: (text: string) => unknown;
  hasAttribute: (tree: unknown, attribute: string, value: string) => boolean;
};

export type SessionPostTapDiagnosticResult = {
  label: string;
  flowPath: string;
  flowBytes: number;
  flowHash: string;
  hierarchyPath: string;
  hierarchyBytes: number;
  screenshotPath: string;
  screenshotBytes: number;
  hierarchyHash: string;
  screenshotHash: string;
  selectorPresence: {
    accountScreen: boolean;
    signOutCta: boolean;
    signOutConfirm: boolean;
    signOutConfirmCta: boolean;
  };
};

function requireOwnedRelativePath(root: string, absolutePath: string, label: string): string {
  const relative = path.relative(root, absolutePath);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.resolve(root, relative) !== path.resolve(absolutePath)
  )
    throw new Error(`${label} escaped the owned artifact root`);
  return relative;
}

function requireBoundedEvidence(label: string, bytes: Buffer): Buffer {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length === 0 ||
    bytes.length > sessionPostTapEvidenceMaxBytes
  )
    throw new Error(`${label} is not bounded owned evidence`);
  return bytes;
}

export async function observeIosSessionPostTapDiagnostic(
  input: SessionPostTapDiagnosticIo & {
    label: string;
    actions: string;
  },
): Promise<SessionPostTapDiagnosticResult> {
  if (!/^[a-z0-9-]+$/u.test(input.label))
    throw new Error('Unsafe session post-tap diagnostic label');
  input.signal.throwIfAborted();
  await input.requireBooted(`${input.label}-before-actions`);

  const flow = path.join(input.output, `${input.label}.yaml`);
  await input.writeText(
    `${input.label}-flow-write`,
    flow,
    `appId: ${input.bundleId}\nname: Native inventory ${input.label}\n---\n${input.actions}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  await input.run(
    input.label,
    'maestro',
    [
      '--no-ansi',
      '--udid',
      input.deviceUdid,
      'test',
      '--debug-output',
      path.join(input.output, `${input.label}-debug`),
      '--test-output-dir',
      path.join(input.output, `${input.label}-artifacts`),
      flow,
    ],
    { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
    300_000,
  );
  input.signal.throwIfAborted();
  await input.requireBooted(`${input.label}-after-actions`);

  const frameTree = await input.run(
    `${input.label}-hierarchy`,
    'maestro',
    ['--no-ansi', '--udid', input.deviceUdid, 'hierarchy'],
    { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
    120_000,
  );
  input.signal.throwIfAborted();
  await input.requireBooted(`${input.label}-before-screenshot`);

  const screenshotPath = path.join(input.output, `${input.label}.png`);
  await input.execute(
    `${input.label}-screenshot`,
    'xcrun',
    ['simctl', 'io', input.deviceUdid, 'screenshot', screenshotPath],
    { timeout: 30_000 },
  );
  input.signal.throwIfAborted();

  const frameTreeRelative = requireOwnedRelativePath(input.output, frameTree, 'Hierarchy output');
  const flowRelative = requireOwnedRelativePath(input.output, flow, 'Flow');
  const flowBytes = requireBoundedEvidence(
    `${input.label} flow evidence`,
    input.readEvidence(`${input.label}-flow-read`, flowRelative, true),
  );
  const hierarchyLogBytes = requireBoundedEvidence(
    `${input.label} hierarchy command output`,
    input.readEvidence(`${input.label}-hierarchy-read`, frameTreeRelative, true),
  );
  input.signal.throwIfAborted();
  const actualTree = input.parseHierarchy(hierarchyLogBytes.toString('utf8'));
  if (!actualTree || typeof actualTree !== 'object' || Array.isArray(actualTree))
    throw new Error(`${input.label} hierarchy is not a structured tree`);
  const canonicalTree = `${input.label}-hierarchy.json`;
  const canonicalTreePath = path.join(input.output, canonicalTree);
  await input.writeText(
    `${input.label}-hierarchy-write`,
    canonicalTreePath,
    JSON.stringify(actualTree),
    { mode: 0o600, flag: 'wx' },
  );
  const hierarchyBytes = requireBoundedEvidence(
    `${input.label} hierarchy evidence`,
    input.readEvidence(`${input.label}-hierarchy-readback`, canonicalTree, true),
  );
  const screenshotRelative = requireOwnedRelativePath(input.output, screenshotPath, 'Screenshot');
  const screenshotBytes = requireBoundedEvidence(
    `${input.label} screenshot evidence`,
    input.readEvidence(`${input.label}-screenshot-read`, screenshotRelative, false),
  );
  if (screenshotBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw new Error(`${input.label} screenshot is not a PNG`);
  const selectorPresence = {
    accountScreen: input.hasAttribute(actualTree, 'resource-id', 'settings.account.screen'),
    signOutCta: input.hasAttribute(actualTree, 'resource-id', 'settings.account.signOutCta'),
    signOutConfirm: input.hasAttribute(
      actualTree,
      'resource-id',
      'settings.account.signOutConfirm',
    ),
    signOutConfirmCta: input.hasAttribute(
      actualTree,
      'resource-id',
      'settings.account.signOutConfirmCta',
    ),
  };
  // Selector presence is diagnostic evidence, not a substitute for the
  // existing confirmation assertion. In particular, an absent confirmation
  // must still be recorded so the caller can retain the failed-navigation
  // evidence before observeSession applies its authoritative 90s assertion.
  input.signal.throwIfAborted();

  return {
    label: input.label,
    flowPath: flowRelative,
    flowBytes: flowBytes.length,
    flowHash: createHash('sha256').update(flowBytes).digest('hex'),
    hierarchyPath: canonicalTree,
    hierarchyBytes: hierarchyBytes.length,
    screenshotPath: screenshotRelative,
    screenshotBytes: screenshotBytes.length,
    hierarchyHash: createHash('sha256').update(hierarchyBytes).digest('hex'),
    screenshotHash: createHash('sha256').update(screenshotBytes).digest('hex'),
    selectorPresence,
  };
}

export async function observeIosSessionSignOutWithDiagnostic(input: {
  report: Record<string, unknown>;
  observePostTapDiagnostic: (label: string, actions: string) => Promise<Record<string, unknown>>;
  observeSession: (
    label: string,
    actions: string,
    viewId: string,
    selector: string,
  ) => Promise<void>;
}): Promise<void> {
  input.report.sessionSignOutPostTapDiagnostic = await input.observePostTapDiagnostic(
    'session-signout-post-tap',
    sessionSignOutPostTapActions,
  );
  await input.observeSession(
    'signout-confirm',
    '',
    'STATE-signout-confirm',
    'settings.account.signOutConfirm',
  );
}
