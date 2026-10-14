import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';

export const EXPLORATION_SCHEMA_VERSION = 1;
export const EXPLORATION_LOCALES = ['en-US', 'pt-BR', 'es-ES'] as const;
export const EXPLORATION_PLATFORMS = ['ios', 'android', 'web'] as const;
export const EXPLORATION_CONNECTORS = ['maestro', 'playwright'] as const;
export const EXPLORATION_DATA_MODES = ['fixture', 'integration'] as const;
export const EXPLORATION_AVAILABILITY = ['available', 'unavailable', 'unknown'] as const;
export const EXPLORATION_MAX_DURATION_MINUTES = 30;
export const EXPLORATION_MAX_UI_ACTIONS = 100;
export const EXPLORATION_UNCHANGED_FAILURE_LIMIT = 2;
export const EXPLORATION_RUNTIME_REQUALIFICATION = [
  'target',
  'build',
  'tool',
  'locale',
  'roles',
  'fixture',
  'reset',
] as const;

export type ExplorationLocale = (typeof EXPLORATION_LOCALES)[number];
export type ExplorationPlatform = (typeof EXPLORATION_PLATFORMS)[number];
export type ExplorationConnector = (typeof EXPLORATION_CONNECTORS)[number];
export type ExplorationDataMode = (typeof EXPLORATION_DATA_MODES)[number];
export type ExplorationAvailability = (typeof EXPLORATION_AVAILABILITY)[number];
export type ExplorationRuntimeRequalification =
  (typeof EXPLORATION_RUNTIME_REQUALIFICATION)[number];

type RecordValue = Record<string, unknown>;

export type ExplorationScenarioDefinition = {
  id: string;
  title: string;
  sourceRefs: string[];
  preconditions: string[];
  actions: string[];
  expectedObservations: string[];
  risk: 'high' | 'medium' | 'low';
};

export type ExplorationCharter = {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;
  platforms: ExplorationPlatform[];
  connectorsByPlatform: Partial<Record<ExplorationPlatform, ExplorationConnector>>;
  locales: ExplorationLocale[];
  roles: string[];
  dataMode: ExplorationDataMode;
  fixture: {
    id: string;
    resetStrategy: string;
  };
  allowedActions: string[];
  excludedExternalEffects: string[];
  budget: {
    maxDurationMinutes: 30;
    maxUiActions: 100;
    stopWhen: 'first-limit-reached';
    unchangedFailureLimit: 2;
  };
  artifactPolicy: {
    directoryMode: '0700';
    fileMode: '0600';
    rawEvidence: 'private-only';
    publicSummary: 'redacted-status-only';
    forbiddenFields: string[];
  };
  requirementRefs: string[];
  requirementPaths: string[];
  scenario: ExplorationScenarioDefinition;
};

export type ExplorationResource = {
  status: ExplorationAvailability;
  id: string | null;
  evidencePaths: string[];
};

export type ExplorationContext = {
  schemaVersion: 1;
  platform: ExplorationPlatform;
  locale: ExplorationLocale;
  target: ExplorationResource & {
    platform: ExplorationPlatform;
    selector: string | null;
    appIdOrOrigin: string | null;
    apiOrigin: string | null;
  };
  build: ExplorationResource & { binarySha256: string | null };
  connector: ExplorationResource & {
    name: ExplorationConnector;
    version: string | null;
  };
  roles: (ExplorationResource & { id: string })[];
  fixture: ExplorationResource & { mode: ExplorationDataMode };
  reset: {
    status: ExplorationAvailability;
    strategy: string;
    verified: boolean;
    evidencePaths: string[];
  };
};

export type PrepareExplorationArguments = {
  charter: string;
  platform: ExplorationPlatform;
  locale: ExplorationLocale;
  contextPath?: string;
  artifactRoot?: string;
};

export type PreparationResult = {
  status: 'prepared' | 'blocked';
  explorationStatus: 'not-run';
  charterId: string;
  platform: ExplorationPlatform;
  locale: ExplorationLocale;
  artifactRoot: string;
  blockedReasons: string[];
  runtimeRequalificationRequired: ExplorationRuntimeRequalification[];
};

const repositoryRoot = path.resolve(__dirname, '../..');
const charterDirectoryName = 'docs/qa/exploration-charters';
const artifactDirectoryName = '.qa/artifacts';
const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const safeSlug = /^[a-z0-9][a-z0-9-]{0,100}$/;
const sha256 = /^[a-f0-9]{64}$/;
const forbiddenValue =
  /(postgres(?:ql)?:\/\/|bearer\s+[a-z0-9._-]+|-----begin|access[_-]?token|refresh[_-]?token)/i;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ownKeys(value: RecordValue, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value))
    if (!allowedSet.has(key)) throw new Error(`${label} contains unknown field ${key}`);
}

function stringValue(
  value: unknown,
  label: string,
  options: { nullable?: boolean } = {},
): string | null {
  if (value === null && options.nullable) return null;
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 500)
    throw new Error(`${label} must be a nonempty single-line string`);
  if (value.includes('\u0000') || value.includes('\n') || value.includes('\r'))
    throw new Error(`${label} contains an unsafe control character`);
  if (forbiddenValue.test(value))
    throw new Error(`${label} contains a forbidden secret-like value`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return stringValue(value, label);
}

function assertHttpOrigin(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL origin`);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.origin !== value ||
    parsed.username ||
    parsed.password
  )
    throw new Error(`${label} must be an origin without credentials or a path`);
}

function assertLoopbackOrigin(value: string, label: string): void {
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const ipv4Loopback = isIP(hostname) === 4 && hostname.split('.').map(Number)[0] === 127;
  if (hostname !== 'localhost' && hostname !== '::1' && !ipv4Loopback)
    throw new Error(`${label} must use a loopback origin for local integration preparation`);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    throw new Error(`${label} is unsupported`);
  return value as T;
}

function uniqueStrings(value: unknown, label: string, options: { min?: number } = {}): string[] {
  if (!Array.isArray(value) || value.length < (options.min ?? 0))
    throw new Error(`${label} must be an array with at least ${options.min ?? 0} entries`);
  const rows = value.map((entry, index) => stringValue(entry, `${label}[${index}]`)!);
  if (new Set(rows).size !== rows.length) throw new Error(`${label} contains duplicates`);
  return rows;
}

function fieldNames(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label} must be a nonempty array`);
  const rows = value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry || entry.trim() !== entry || entry.length > 100)
      throw new Error(`${label}[${index}] must be a nonempty field name`);
    if (entry.includes('\u0000') || entry.includes('\n') || entry.includes('\r'))
      throw new Error(`${label}[${index}] contains an unsafe control character`);
    return entry;
  });
  if (new Set(rows).size !== rows.length) throw new Error(`${label} contains duplicates`);
  return rows;
}

function relativePath(value: unknown, label: string): string {
  const row = stringValue(value, label)!;
  if (
    path.isAbsolute(row) ||
    /^[A-Za-z]:/.test(row) ||
    row.includes('\\') ||
    row.split('/').includes('..') ||
    row.startsWith('./')
  )
    throw new Error(`${label} must be a repository-relative path`);
  return row;
}

function relativePaths(value: unknown, label: string, options: { min?: number } = {}): string[] {
  const rows = uniqueStrings(value, label, options);
  return rows.map((row, index) => relativePath(row, `${label}[${index}]`));
}

function assertPathInside(root: string, candidate: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`))
    throw new Error(`${label} escapes the repository root`);
  return resolved;
}

async function assertPrivateEvidenceFile(file: string, label: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || (await realpath(file)) !== file)
    throw new Error(`${label} must be a canonical regular file`);
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (uid === undefined || info.uid !== uid)
    throw new Error(`${label} must be owned by the current user`);
  if ((info.mode & 0o777) !== 0o600) throw new Error(`${label} must have mode 0600`);

  const parent = path.dirname(file);
  const parentInfo = await lstat(parent);
  if (
    !parentInfo.isDirectory() ||
    (await realpath(parent)) !== parent ||
    uid === undefined ||
    parentInfo.uid !== uid ||
    (parentInfo.mode & 0o777) !== 0o700
  )
    throw new Error(`${label} immediate parent must be an owned private directory with mode 0700`);
}

async function existingRegularFile(
  root: string,
  relative: string,
  label: string,
  options: { privateEvidence?: boolean } = {},
): Promise<string> {
  const file = assertPathInside(root, path.resolve(root, relative), label);
  const info = await lstat(file);
  if (!info.isFile() || (await realpath(file)) !== file)
    throw new Error(`${label} must be a canonical regular file`);
  if (options.privateEvidence) await assertPrivateEvidenceFile(file, label);
  return file;
}

function hashFile(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requiredResourceStatus(value: RecordValue, label: string): ExplorationAvailability {
  return enumValue(value.status, EXPLORATION_AVAILABILITY, `${label}.status`);
}

function parseEvidencePaths(value: unknown, label: string): string[] {
  return relativePaths(value, label);
}

function parseResource(value: unknown, label: string): ExplorationResource {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  ownKeys(value, ['status', 'id', 'evidencePaths'], label);
  const status = requiredResourceStatus(value, label);
  const id = nullableString(value.id, `${label}.id`);
  const evidencePaths = parseEvidencePaths(value.evidencePaths, `${label}.evidencePaths`);
  if (status === 'available' && (!id || evidencePaths.length === 0))
    throw new Error(`${label} available status requires id and evidencePaths`);
  if (status !== 'available' && (id !== null || evidencePaths.length > 0))
    throw new Error(`${label} unavailable/unknown status cannot carry identity or evidence`);
  return { status, id, evidencePaths };
}

function parseContext(value: unknown, label: string): ExplorationContext {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  ownKeys(
    value,
    [
      'schemaVersion',
      'platform',
      'locale',
      'target',
      'build',
      'connector',
      'roles',
      'fixture',
      'reset',
    ],
    label,
  );
  if (value.schemaVersion !== EXPLORATION_SCHEMA_VERSION)
    throw new Error(`${label}.schemaVersion is unsupported`);
  const platform = enumValue(value.platform, EXPLORATION_PLATFORMS, `${label}.platform`);
  const locale = enumValue(value.locale, EXPLORATION_LOCALES, `${label}.locale`);

  if (!isRecord(value.target)) throw new Error(`${label}.target must be an object`);
  ownKeys(
    value.target,
    ['status', 'id', 'evidencePaths', 'platform', 'selector', 'appIdOrOrigin', 'apiOrigin'],
    `${label}.target`,
  );
  const targetResource = parseResource(
    { status: value.target.status, id: value.target.id, evidencePaths: value.target.evidencePaths },
    `${label}.target`,
  );
  const targetPlatform = enumValue(
    value.target.platform,
    EXPLORATION_PLATFORMS,
    `${label}.target.platform`,
  );
  const selector = nullableString(value.target.selector, `${label}.target.selector`);
  const appIdOrOrigin = nullableString(value.target.appIdOrOrigin, `${label}.target.appIdOrOrigin`);
  const apiOrigin = nullableString(value.target.apiOrigin, `${label}.target.apiOrigin`);
  if (targetPlatform !== platform)
    throw new Error(`${label}.target.platform differs from platform`);
  if (targetResource.status === 'available' && (!selector || !appIdOrOrigin || !apiOrigin))
    throw new Error(
      `${label}.target available status requires selector, appIdOrOrigin and apiOrigin`,
    );
  if (targetResource.status !== 'available' && (selector || appIdOrOrigin || apiOrigin))
    throw new Error(`${label}.target unavailable/unknown status cannot carry target identity`);
  if (apiOrigin) assertHttpOrigin(apiOrigin, `${label}.target.apiOrigin`);
  if (appIdOrOrigin && platform === 'web')
    assertHttpOrigin(appIdOrOrigin, `${label}.target.appIdOrOrigin`);
  if (
    appIdOrOrigin &&
    platform !== 'web' &&
    !/^[A-Za-z][A-Za-z0-9]*(?:[._][A-Za-z0-9]+)+$/.test(appIdOrOrigin)
  )
    throw new Error(`${label}.target.appIdOrOrigin must be a native application id`);

  if (!isRecord(value.build)) throw new Error(`${label}.build must be an object`);
  ownKeys(value.build, ['status', 'id', 'evidencePaths', 'binarySha256'], `${label}.build`);
  const buildResource = parseResource(
    { status: value.build.status, id: value.build.id, evidencePaths: value.build.evidencePaths },
    `${label}.build`,
  );
  const binarySha256 = nullableString(value.build.binarySha256, `${label}.build.binarySha256`);
  if (binarySha256 !== null && !sha256.test(binarySha256))
    throw new Error(`${label}.build.binarySha256 must be a lowercase SHA-256`);
  if (buildResource.status === 'available' && binarySha256 === null)
    throw new Error(`${label}.build available status requires binarySha256`);
  if (buildResource.status !== 'available' && binarySha256 !== null)
    throw new Error(`${label}.build unavailable/unknown status cannot carry binary identity`);

  if (!isRecord(value.connector)) throw new Error(`${label}.connector must be an object`);
  ownKeys(
    value.connector,
    ['status', 'id', 'evidencePaths', 'name', 'version'],
    `${label}.connector`,
  );
  const connectorResource = parseResource(
    {
      status: value.connector.status,
      id: value.connector.id,
      evidencePaths: value.connector.evidencePaths,
    },
    `${label}.connector`,
  );
  const connector = enumValue(
    value.connector.name,
    EXPLORATION_CONNECTORS,
    `${label}.connector.name`,
  );
  const connectorVersion = nullableString(value.connector.version, `${label}.connector.version`);
  if (connectorResource.status === 'available' && connectorVersion === null)
    throw new Error(`${label}.connector available status requires version`);
  if (connectorResource.status !== 'available' && connectorVersion !== null)
    throw new Error(`${label}.connector unavailable/unknown status cannot carry version`);

  if (!Array.isArray(value.roles) || value.roles.length === 0)
    throw new Error(`${label}.roles must be a nonempty array`);
  const roles = value.roles.map((role, index) => {
    if (!isRecord(role)) throw new Error(`${label}.roles[${index}] must be an object`);
    ownKeys(role, ['status', 'id', 'evidencePaths'], `${label}.roles[${index}]`);
    const status = requiredResourceStatus(role, `${label}.roles[${index}]`);
    const id = stringValue(role.id, `${label}.roles[${index}].id`)!;
    const evidencePaths = parseEvidencePaths(
      role.evidencePaths,
      `${label}.roles[${index}].evidencePaths`,
    );
    if (status === 'available' && evidencePaths.length === 0)
      throw new Error(`${label}.roles[${index}] available status requires evidencePaths`);
    if (status !== 'available' && evidencePaths.length > 0)
      throw new Error(`${label}.roles[${index}] unavailable/unknown status cannot carry evidence`);
    return { status, id, evidencePaths };
  });
  if (new Set(roles.map((role) => role.id)).size !== roles.length)
    throw new Error(`${label}.roles contains duplicate ids`);

  if (!isRecord(value.fixture)) throw new Error(`${label}.fixture must be an object`);
  ownKeys(value.fixture, ['status', 'id', 'evidencePaths', 'mode'], `${label}.fixture`);
  const fixtureResource = parseResource(
    {
      status: value.fixture.status,
      id: value.fixture.id,
      evidencePaths: value.fixture.evidencePaths,
    },
    `${label}.fixture`,
  );
  const fixtureMode = enumValue(
    value.fixture.mode,
    EXPLORATION_DATA_MODES,
    `${label}.fixture.mode`,
  );
  if (fixtureMode === 'integration' && targetResource.status === 'available')
    assertLoopbackOrigin(apiOrigin!, `${label}.target.apiOrigin`);

  if (!isRecord(value.reset)) throw new Error(`${label}.reset must be an object`);
  ownKeys(value.reset, ['status', 'strategy', 'verified', 'evidencePaths'], `${label}.reset`);
  const resetStatus = requiredResourceStatus(value.reset, `${label}.reset`);
  const resetStrategy = stringValue(value.reset.strategy, `${label}.reset.strategy`)!;
  if (typeof value.reset.verified !== 'boolean')
    throw new Error(`${label}.reset.verified must be boolean`);
  const resetEvidencePaths = parseEvidencePaths(
    value.reset.evidencePaths,
    `${label}.reset.evidencePaths`,
  );
  if (resetStatus === 'available' && (!value.reset.verified || resetEvidencePaths.length === 0))
    throw new Error(`${label}.reset available status requires verified=true and evidencePaths`);
  if (resetStatus !== 'available' && (value.reset.verified || resetEvidencePaths.length > 0))
    throw new Error(`${label}.reset unavailable/unknown status cannot carry reset evidence`);

  return {
    schemaVersion: 1,
    platform,
    locale,
    target: { ...targetResource, platform: targetPlatform, selector, appIdOrOrigin, apiOrigin },
    build: { ...buildResource, binarySha256 },
    connector: { ...connectorResource, name: connector, version: connectorVersion },
    roles,
    fixture: { ...fixtureResource, mode: fixtureMode },
    reset: {
      status: resetStatus,
      strategy: resetStrategy,
      verified: value.reset.verified,
      evidencePaths: resetEvidencePaths,
    },
  };
}

function validateCharterShape(value: unknown, label: string): ExplorationCharter {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  ownKeys(
    value,
    [
      'schemaVersion',
      'id',
      'title',
      'summary',
      'platforms',
      'connectorsByPlatform',
      'locales',
      'roles',
      'dataMode',
      'fixture',
      'allowedActions',
      'excludedExternalEffects',
      'budget',
      'artifactPolicy',
      'requirementRefs',
      'requirementPaths',
      'scenario',
    ],
    label,
  );
  if (value.schemaVersion !== EXPLORATION_SCHEMA_VERSION)
    throw new Error(`${label}.schemaVersion is unsupported`);
  const id = stringValue(value.id, `${label}.id`)!;
  if (!/^EXP-[A-Z0-9-]+$/.test(id)) throw new Error(`${label}.id must use the EXP- charter format`);
  const title = stringValue(value.title, `${label}.title`)!;
  const summary = stringValue(value.summary, `${label}.summary`)!;
  const platforms = uniqueStrings(value.platforms, `${label}.platforms`, { min: 1 }).map((row) =>
    enumValue(row, EXPLORATION_PLATFORMS, `${label}.platforms`),
  );
  if (!isRecord(value.connectorsByPlatform))
    throw new Error(`${label}.connectorsByPlatform must be an object`);
  ownKeys(value.connectorsByPlatform, EXPLORATION_PLATFORMS, `${label}.connectorsByPlatform`);
  const connectorsByPlatform: Partial<Record<ExplorationPlatform, ExplorationConnector>> = {};
  for (const platform of platforms)
    connectorsByPlatform[platform] = enumValue(
      value.connectorsByPlatform[platform],
      EXPLORATION_CONNECTORS,
      `${label}.connectorsByPlatform.${platform}`,
    );
  const locales = uniqueStrings(value.locales, `${label}.locales`, {
    min: EXPLORATION_LOCALES.length,
  }).map((row) => enumValue(row, EXPLORATION_LOCALES, `${label}.locales`));
  for (const locale of EXPLORATION_LOCALES)
    if (!locales.includes(locale)) throw new Error(`${label}.locales must include ${locale}`);
  const roles = uniqueStrings(value.roles, `${label}.roles`, { min: 1 });
  const dataMode = enumValue(value.dataMode, EXPLORATION_DATA_MODES, `${label}.dataMode`);
  if (!isRecord(value.fixture)) throw new Error(`${label}.fixture must be an object`);
  ownKeys(value.fixture, ['id', 'resetStrategy'], `${label}.fixture`);
  const fixtureId = stringValue(value.fixture.id, `${label}.fixture.id`)!;
  const resetStrategy = stringValue(value.fixture.resetStrategy, `${label}.fixture.resetStrategy`)!;
  const allowedActions = uniqueStrings(value.allowedActions, `${label}.allowedActions`, { min: 1 });
  const excludedExternalEffects = uniqueStrings(
    value.excludedExternalEffects,
    `${label}.excludedExternalEffects`,
    { min: 1 },
  );
  if (!isRecord(value.budget)) throw new Error(`${label}.budget must be an object`);
  ownKeys(
    value.budget,
    ['maxDurationMinutes', 'maxUiActions', 'stopWhen', 'unchangedFailureLimit'],
    `${label}.budget`,
  );
  if (
    value.budget.maxDurationMinutes !== EXPLORATION_MAX_DURATION_MINUTES ||
    value.budget.maxUiActions !== EXPLORATION_MAX_UI_ACTIONS ||
    value.budget.stopWhen !== 'first-limit-reached' ||
    value.budget.unchangedFailureLimit !== EXPLORATION_UNCHANGED_FAILURE_LIMIT
  )
    throw new Error(`${label}.budget must enforce the T16 30-minute/100-action/two-failure limits`);
  if (!isRecord(value.artifactPolicy)) throw new Error(`${label}.artifactPolicy must be an object`);
  ownKeys(
    value.artifactPolicy,
    ['directoryMode', 'fileMode', 'rawEvidence', 'publicSummary', 'forbiddenFields'],
    `${label}.artifactPolicy`,
  );
  if (
    value.artifactPolicy.directoryMode !== '0700' ||
    value.artifactPolicy.fileMode !== '0600' ||
    value.artifactPolicy.rawEvidence !== 'private-only' ||
    value.artifactPolicy.publicSummary !== 'redacted-status-only'
  )
    throw new Error(`${label}.artifactPolicy does not enforce private evidence`);
  const forbiddenFields = fieldNames(
    value.artifactPolicy.forbiddenFields,
    `${label}.artifactPolicy.forbiddenFields`,
  );
  if (!forbiddenFields.some((field) => /token|password|cookie|secret|credential/i.test(field)))
    throw new Error(`${label}.artifactPolicy must name secret-like fields`);
  const requirementRefs = uniqueStrings(value.requirementRefs, `${label}.requirementRefs`, {
    min: 1,
  });
  const requirementPaths = relativePaths(value.requirementPaths, `${label}.requirementPaths`, {
    min: 1,
  });
  if (!isRecord(value.scenario)) throw new Error(`${label}.scenario must be an object`);
  ownKeys(
    value.scenario,
    ['id', 'title', 'sourceRefs', 'preconditions', 'actions', 'expectedObservations', 'risk'],
    `${label}.scenario`,
  );
  const scenario: ExplorationScenarioDefinition = {
    id: stringValue(value.scenario.id, `${label}.scenario.id`)!,
    title: stringValue(value.scenario.title, `${label}.scenario.title`)!,
    sourceRefs: uniqueStrings(value.scenario.sourceRefs, `${label}.scenario.sourceRefs`, {
      min: 1,
    }),
    preconditions: uniqueStrings(value.scenario.preconditions, `${label}.scenario.preconditions`, {
      min: 1,
    }),
    actions: uniqueStrings(value.scenario.actions, `${label}.scenario.actions`, { min: 1 }),
    expectedObservations: uniqueStrings(
      value.scenario.expectedObservations,
      `${label}.scenario.expectedObservations`,
      { min: 1 },
    ),
    risk: enumValue(
      value.scenario.risk,
      ['high', 'medium', 'low'] as const,
      `${label}.scenario.risk`,
    ),
  };
  if (!safeId.test(scenario.id)) throw new Error(`${label}.scenario.id is invalid`);
  if (!scenario.sourceRefs.every((ref) => requirementRefs.includes(ref)))
    throw new Error(`${label}.scenario.sourceRefs must reference requirementRefs`);
  return {
    schemaVersion: 1,
    id,
    title,
    summary,
    platforms,
    connectorsByPlatform,
    locales,
    roles,
    dataMode,
    fixture: { id: fixtureId, resetStrategy },
    allowedActions,
    excludedExternalEffects,
    budget: {
      maxDurationMinutes: 30,
      maxUiActions: 100,
      stopWhen: 'first-limit-reached',
      unchangedFailureLimit: 2,
    },
    artifactPolicy: {
      directoryMode: '0700',
      fileMode: '0600',
      rawEvidence: 'private-only',
      publicSummary: 'redacted-status-only',
      forbiddenFields,
    },
    requirementRefs,
    requirementPaths,
    scenario,
  };
}

export async function loadExplorationCharters(
  root = repositoryRoot,
): Promise<ExplorationCharter[]> {
  const directory = await existingRegularDirectory(
    root,
    charterDirectoryName,
    'Exploration charter directory',
  );
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) throw new Error('No exploration charter definitions found');
  const charters: ExplorationCharter[] = [];
  for (const file of files) {
    const relative = `${charterDirectoryName}/${file}`;
    const bytes = await readFile(await existingRegularFile(root, relative, `Charter ${file}`));
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error(`Charter ${file} is not valid JSON`);
    }
    const charter = validateCharterShape(value, relative);
    for (const requirementPath of charter.requirementPaths)
      await existingRegularFile(root, requirementPath, `Requirement ${requirementPath}`);
    charters.push(charter);
  }
  if (new Set(charters.map((charter) => charter.id)).size !== charters.length)
    throw new Error('Exploration charter ids must be unique');
  return charters;
}

async function existingRegularDirectory(
  root: string,
  relative: string,
  label: string,
): Promise<string> {
  const directory = assertPathInside(root, path.resolve(root, relative), label);
  const info = await lstat(directory);
  if (!info.isDirectory() || (await realpath(directory)) !== directory)
    throw new Error(`${label} must be a canonical directory`);
  return directory;
}

function unknownContext(
  charter: ExplorationCharter,
  platform: ExplorationPlatform,
  locale: ExplorationLocale,
): ExplorationContext {
  const connector = charter.connectorsByPlatform[platform];
  if (!connector) throw new Error(`Charter ${charter.id} does not support ${platform}`);
  return {
    schemaVersion: 1,
    platform,
    locale,
    target: {
      status: 'unknown',
      id: null,
      evidencePaths: [],
      platform,
      selector: null,
      appIdOrOrigin: null,
      apiOrigin: null,
    },
    build: { status: 'unknown', id: null, evidencePaths: [], binarySha256: null },
    connector: { status: 'unknown', id: null, evidencePaths: [], name: connector, version: null },
    roles: charter.roles.map((id) => ({ status: 'unknown', id, evidencePaths: [] })),
    fixture: { status: 'unknown', id: null, evidencePaths: [], mode: charter.dataMode },
    reset: {
      status: 'unknown',
      strategy: charter.fixture.resetStrategy,
      verified: false,
      evidencePaths: [],
    },
  };
}

async function validateContextEvidence(root: string, context: ExplorationContext): Promise<void> {
  const resources = [
    context.target,
    context.build,
    context.connector,
    ...context.roles,
    context.fixture,
    context.reset,
  ];
  for (const resource of resources)
    if (resource.status === 'available')
      for (const evidencePath of resource.evidencePaths)
        await existingRegularFile(root, evidencePath, 'Context evidence', {
          privateEvidence: true,
        });
}

export async function loadExplorationContext(
  charter: ExplorationCharter,
  args: Pick<PrepareExplorationArguments, 'platform' | 'locale' | 'contextPath'>,
  root = repositoryRoot,
): Promise<{ context: ExplorationContext; sourcePath: string | null }> {
  if (!args.contextPath) {
    return { context: unknownContext(charter, args.platform, args.locale), sourcePath: null };
  }
  const contextFile = await existingRegularFile(root, args.contextPath, 'Exploration context', {
    privateEvidence: true,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse((await readFile(contextFile)).toString('utf8'));
  } catch {
    throw new Error('Exploration context is not valid JSON');
  }
  const context = parseContext(parsed, 'Exploration context');
  if (context.platform !== args.platform || context.locale !== args.locale)
    throw new Error('Exploration context platform/locale differs from requested selection');
  if (!charter.platforms.includes(context.platform))
    throw new Error('Charter does not support requested platform');
  if (!charter.locales.includes(context.locale))
    throw new Error('Charter does not support requested locale');
  const expectedConnector = charter.connectorsByPlatform[context.platform];
  if (context.connector.name !== expectedConnector)
    throw new Error('Context connector does not match charter/platform');
  if (context.fixture.mode !== charter.dataMode)
    throw new Error('Context fixture mode does not match charter');
  if (context.fixture.status === 'available' && context.fixture.id !== charter.fixture.id)
    throw new Error('Context fixture id does not match charter fixture contract');
  if (context.reset.strategy !== charter.fixture.resetStrategy)
    throw new Error('Context reset strategy does not match charter');
  if (
    context.roles.length !== charter.roles.length ||
    context.roles.some((role, index) => role.id !== charter.roles[index])
  )
    throw new Error('Context roles do not match charter role contract');
  await validateContextEvidence(root, context);
  return { context, sourcePath: contextFile };
}

export function parsePrepareExplorationArguments(
  argv: readonly string[],
): PrepareExplorationArguments {
  const values = new Map<string, string>();
  const allowed = new Set(['charter', 'platform', 'locale', 'context', 'artifact-root']);
  for (let index = 0; index < argv.length; index++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[index]);
    if (!match || !allowed.has(match[1]) || values.has(match[1]))
      throw new Error('Invalid or duplicate exploration preparation argument');
    const value = match[2] === undefined ? argv[++index] : match[2];
    if (!value || value.startsWith('--') || value.trim() !== value)
      throw new Error(`Exploration argument --${match[1]} requires one nonempty value`);
    values.set(match[1], value);
  }
  const charter = values.get('charter');
  const platform = values.get('platform');
  const locale = values.get('locale');
  if (!charter || !safeId.test(charter) || !platform || !locale)
    throw new Error('Exploration preparation requires charter, platform and locale');
  const parsed: PrepareExplorationArguments = {
    charter,
    platform: enumValue(platform, EXPLORATION_PLATFORMS, 'platform'),
    locale: enumValue(locale, EXPLORATION_LOCALES, 'locale'),
  };
  const contextPath = values.get('context');
  const artifactRoot = values.get('artifact-root');
  if (contextPath !== undefined) parsed.contextPath = contextPath;
  if (artifactRoot !== undefined) parsed.artifactRoot = artifactRoot;
  return parsed;
}

function redactedContext(context: ExplorationContext) {
  return {
    schemaVersion: 1,
    platform: context.platform,
    locale: context.locale,
    targetStatus: context.target.status,
    buildStatus: context.build.status,
    connectorStatus: context.connector.status,
    roleStatuses: context.roles.map((role) => role.status),
    fixtureStatus: context.fixture.status,
    resetStatus: context.reset.status,
    resetVerified: context.reset.verified,
  };
}

function blockedReasons(context: ExplorationContext): string[] {
  const reasons: string[] = [
    'PREPARATION_ONLY: no native, browser, backend or connector action was executed',
  ];
  const statusRows: [string, ExplorationAvailability][] = [
    ['target', context.target.status],
    ['build', context.build.status],
    ['connector', context.connector.status],
    ...context.roles.map(
      (role, index) => [`role[${index}]`, role.status] as [string, ExplorationAvailability],
    ),
    ['fixture', context.fixture.status],
    ['reset', context.reset.status],
  ];
  for (const [label, status] of statusRows)
    if (status !== 'available') reasons.push(`PREREQUISITE_${status.toUpperCase()}: ${label}`);
  if (context.reset.status === 'available' && !context.reset.verified)
    reasons.push('RESET_NOT_VERIFIED: reset evidence is not confirmed');
  return reasons;
}

async function createArtifactRoot(
  root: string,
  args: PrepareExplorationArguments,
  now: Date,
): Promise<string> {
  const artifacts = await existingRegularDirectory(
    root,
    artifactDirectoryName,
    'QA artifact directory',
  );
  const defaultId = `exploration-${args.charter.toLowerCase()}-${args.platform}-${args.locale.toLowerCase()}-${now
    .toISOString()
    .replace(/[^0-9]/g, '')}`;
  if (!safeSlug.test(defaultId)) throw new Error('Generated exploration artifact id is invalid');
  const candidate = args.artifactRoot
    ? path.resolve(root, args.artifactRoot)
    : path.join(artifacts, defaultId);
  if (candidate === artifacts || !candidate.startsWith(`${artifacts}${path.sep}`))
    throw new Error('Exploration artifact root must remain within .qa/artifacts');
  const parentRelative = path.relative(artifacts, path.dirname(candidate));
  let parent = artifacts;
  for (const segment of parentRelative ? parentRelative.split(path.sep) : []) {
    parent = path.join(parent, segment);
    try {
      const info = await lstat(parent);
      if (!info.isDirectory() || (await realpath(parent)) !== parent)
        throw new Error('Exploration artifact parent must be a canonical directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  try {
    const info = await lstat(candidate);
    if (!info.isDirectory() || (await realpath(candidate)) !== candidate)
      throw new Error('Exploration artifact root must be a canonical directory');
    if ((await readdir(candidate)).length > 0)
      throw new Error('Exploration artifact root must be empty');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(candidate, { recursive: true, mode: 0o700 });
  }
  await chmod(candidate, 0o700);
  await mkdir(path.join(candidate, 'evidence'), { mode: 0o700 });
  await chmod(path.join(candidate, 'evidence'), 0o700);
  return candidate;
}

async function writePrivate(root: string, relative: string, value: string): Promise<void> {
  const target = path.join(root, relative);
  await writeFile(target, value, { flag: 'wx', mode: 0o600 });
  await chmod(target, 0o600);
}

async function writePreparationArtifacts(
  root: string,
  charter: ExplorationCharter,
  context: ExplorationContext,
  contextSource: string | null,
  args: PrepareExplorationArguments,
  charterHash: string,
  requirementHashes: Record<string, string>,
  reasons: string[],
  now: Date,
): Promise<void> {
  const status = reasons.length === 1 ? 'prepared' : 'blocked';
  const loopId = path.basename(root);
  const relativeArtifactRoot = path.relative(repositoryRoot, root);
  const preparation = {
    schemaVersion: 1,
    kind: 'agent-exploration-preparation',
    loopId,
    status,
    explorationStatus: 'not-run',
    createdAt: now.toISOString(),
    charter: {
      id: charter.id,
      sha256: charterHash,
      scenarioId: charter.scenario.id,
      requirementRefs: charter.requirementRefs,
      requirementPaths: charter.requirementPaths,
      requirementHashes,
    },
    selection: { platform: args.platform, locale: args.locale },
    contextSource: contextSource ? path.relative(repositoryRoot, contextSource) : null,
    context,
    budgets: charter.budget,
    budgetEnforcement:
      'declaration-only: T16-B must enforce wall-clock and actual UI-action counters',
    runtimeRequalificationRequired: [...EXPLORATION_RUNTIME_REQUALIFICATION],
    roleSessionProof:
      'pending: preparation does not prove authenticated role identity or independent sessions',
    artifactPolicy: charter.artifactPolicy,
    observations: [],
    attempts: [],
    blockedReasons: reasons,
    artifactRoot: relativeArtifactRoot,
  };
  await writePrivate(root, 'preparation.private.json', JSON.stringify(preparation, null, 2) + '\n');

  const coverage = {
    schemaVersion: 1,
    loopId,
    family: 'mychampions',
    surfaces: [args.platform],
    environment: { name: 'local', status: 'preparation-only' },
    target: redactedContext(context),
    gitSha: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    stoppingPolicy: {
      maxDurationMinutes: charter.budget.maxDurationMinutes,
      maxUiActions: charter.budget.maxUiActions,
      stopWhen: charter.budget.stopWhen,
      unchangedFailureLimit: charter.budget.unchangedFailureLimit,
    },
    budgetEnforcement:
      'declaration-only: T16-B must enforce wall-clock and actual UI-action counters',
    runtimeRequalification: {
      status: 'pending-independent-requalification',
      resources: [...EXPLORATION_RUNTIME_REQUALIFICATION],
    },
    roleSessionProof:
      'pending: preparation does not prove authenticated role identity or independent sessions',
    inventorySources: charter.requirementPaths,
    scenarios: [
      {
        id: charter.scenario.id,
        title: charter.scenario.title,
        sourceRefs: charter.scenario.sourceRefs,
        preconditions: charter.scenario.preconditions,
        actions: charter.scenario.actions,
        expectedObservations: charter.scenario.expectedObservations,
        platform: args.platform,
        locale: args.locale,
        status: 'blocked',
        blocker: 'PREPARATION_ONLY',
      },
    ],
    attempts: [],
    observations: [],
    evidencePaths: [],
    docChanges: [],
    bugs: [],
    blockers: reasons,
  };
  await writePrivate(root, 'coverage.json', JSON.stringify(coverage, null, 2) + '\n');
  await writePrivate(
    root,
    'exploration.md',
    [
      `# Agent exploration preparation — ${charter.id}`,
      '',
      `Status: **${status === 'prepared' ? 'PREPARED' : 'BLOCKED'}** (preparation only)`,
      '',
      'This artifact contains a validated charter/context template. It records no product observation, action, assertion, bug, connector call, target acquisition, backend write, or exploration pass.',
      '',
      '## Scope',
      `- Charter: ${charter.id} — ${charter.title}`,
      `- Scenario: ${charter.scenario.id}`,
      `- Platform: ${args.platform}`,
      `- Locale: ${args.locale}`,
      '- Family: MyChampions',
      `- Data mode: ${charter.dataMode}; no fixture was acquired or mutated`,
      '',
      '## Limits',
      `- Stop at ${charter.budget.maxDurationMinutes} minutes or ${charter.budget.maxUiActions} UI actions, whichever comes first`,
      `- Stop an unchanged failing branch after ${charter.budget.unchangedFailureLimit} attempts`,
      '- Count every action, failure, block, cancellation, and cleanup result in the eventual run artifact',
      '- Budget enforcement is declaration-only here; T16-B must enforce elapsed time and actual UI-action counters',
      '',
      '## Prerequisite status',
      `- Target: ${context.target.status}`,
      `- Build: ${context.build.status}`,
      `- Connector: ${context.connector.status}`,
      `- Roles: ${context.roles.map((role) => role.status).join(', ')}`,
      `- Fixture: ${context.fixture.status}`,
      `- Reset: ${context.reset.status}${context.reset.verified ? ' (verified)' : ''}`,
      '',
      '## Runtime requalification still required',
      '- Available declarations remain declarations only; T16-B must independently requalify target, build, tool, locale, roles, fixture, and reset before any action.',
      '- Authenticated role identity and independent role/session proof remain pending until T16-B runtime evidence exists.',
      '',
      '## Allowed action boundary',
      ...charter.allowedActions.map((action) => `- ${action}`),
      '',
      '## Excluded effects',
      ...charter.excludedExternalEffects.map((effect) => `- ${effect}`),
      '',
      '## Stop reasons',
      ...reasons.map((reason) => `- ${reason}`),
      '',
      '## Next step',
      'A T16-B execution adapter must independently verify the target, build, tool, locale, roles, fixture, reset, cleanup boundary, and role/session proof before taking one reversible action. Preparation is never converted into an exploration pass.',
      '',
    ].join('\n'),
  );
  await writePrivate(
    root,
    'bugs.md',
    '# Bugs\n\nNone — exploration was not executed by the preparation command.\n',
  );
  await writePrivate(
    root,
    'doc-changes.md',
    '# Documentation changes\n\nNone — this is preparation-only test infrastructure.\n',
  );
}

export async function prepareExploration(
  args: PrepareExplorationArguments,
  options: { repositoryRoot?: string; now?: Date } = {},
): Promise<PreparationResult> {
  const root = path.resolve(options.repositoryRoot ?? repositoryRoot);
  const charters = await loadExplorationCharters(root);
  const charter = charters.find((candidate) => candidate.id === args.charter);
  if (!charter) throw new Error(`Unknown exploration charter ${args.charter}`);
  if (!charter.platforms.includes(args.platform))
    throw new Error(`Charter ${charter.id} does not support ${args.platform}`);
  if (!charter.locales.includes(args.locale))
    throw new Error(`Charter ${charter.id} does not support ${args.locale}`);
  const expectedConnector = charter.connectorsByPlatform[args.platform];
  if (!expectedConnector)
    throw new Error(`Charter ${charter.id} has no connector for ${args.platform}`);
  const { context, sourcePath } = await loadExplorationContext(charter, args, root);
  const reasons = blockedReasons(context);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.valueOf())) throw new Error('Preparation timestamp is invalid');
  const artifact = await createArtifactRoot(root, args, now);
  const charterFile = path.join(
    root,
    charterDirectoryName,
    `${charter.id.toLowerCase().replace(/^exp-/, '')}.json`,
  );
  const charterBytes = await readFile(charterFile);
  const requirementHashes: Record<string, string> = {};
  for (const requirementPath of charter.requirementPaths)
    requirementHashes[requirementPath] = hashFile(await readFile(path.join(root, requirementPath)));
  await writePreparationArtifacts(
    artifact,
    charter,
    context,
    sourcePath,
    args,
    hashFile(charterBytes),
    requirementHashes,
    reasons,
    now,
  );
  return {
    status: reasons.length === 1 ? 'prepared' : 'blocked',
    explorationStatus: 'not-run',
    charterId: charter.id,
    platform: args.platform,
    locale: args.locale,
    artifactRoot: artifact,
    blockedReasons: reasons,
    runtimeRequalificationRequired: [...EXPLORATION_RUNTIME_REQUALIFICATION],
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const args = parsePrepareExplorationArguments(argv);
    const result = await prepareExploration(args);
    console.log(
      JSON.stringify({
        status: result.status,
        explorationStatus: result.explorationStatus,
        charter: result.charterId,
        platform: result.platform,
        locale: result.locale,
        artifactRoot: path.relative(repositoryRoot, result.artifactRoot),
        blockedReasons: result.blockedReasons,
        runtimeRequalificationRequired: result.runtimeRequalificationRequired,
      }),
    );
    return result.status === 'blocked' ? 2 : 0;
  } catch (error) {
    console.error(
      `Exploration preparation blocked: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
