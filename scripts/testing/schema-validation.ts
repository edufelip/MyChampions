import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, lstatSync, existsSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import Ajv from 'ajv';

// Both tsx and Playwright load this client package as CommonJS.
const directory = path.join(__dirname, 'schemas');
const ajv = new Ajv({ allErrors: true, strictTypes: false, strictRequired: false });
ajv.addFormat('utc-timestamp', (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString() === value;
});
ajv.addFormat('http-origin', (value: string) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
});
const names = new Set([
  'resource-manifest-v1',
  'api-process-v1',
  'application-fixtures-v1',
  'session-request-v1',
  'session-event-v1',
  'session-receipt-v1',
  'domain-snapshot-v1',
  'connection-snapshot-v1',
  'public-receipt-v1',
  'expo-process-v1',
  'integration-context-v1',
  'integration-assertions-v1',
  'playwright-report-v1',
  'integration-harness-block-v1',
]);
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

export function loadTestingSchema(name: string) {
  if (!names.has(name)) throw new Error('Unknown testing schema');
  let validate = validators.get(name);
  if (!validate) {
    const bytes = readFileSync(path.join(directory, `${name}.schema.json`));
    if (
      ![
        'public-receipt-v1',
        'expo-process-v1',
        'integration-context-v1',
        'integration-assertions-v1',
        'playwright-report-v1',
        'integration-harness-block-v1',
      ].includes(name)
    ) {
      const provenance = JSON.parse(
        readFileSync(path.join(directory, 'server-schema-provenance.json'), 'utf8'),
      ) as { copies: { path: string; sha256: string }[] };
      if (
        provenance.copies.find((copy) => copy.path === `${name}.schema.json`)?.sha256 !==
        createHash('sha256').update(bytes).digest('hex')
      )
        throw new Error('Vendored testing schema integrity mismatch');
    }
    validate = ajv.compile(JSON.parse(bytes.toString()));
    validators.set(name, validate);
  }
  return validate;
}

export function assertTestingDocument(name: string, value: unknown): void {
  const validate = loadTestingSchema(name);
  if (!validate(value))
    throw new Error(
      `Invalid ${name} document (${validate.errors?.map((error) => `${error.instancePath || '/'}:${error.keyword}`).join(', ')})`,
    );
}

export function assertArtifactPath(artifactRoot: string, relative: string): string {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    /^[A-Za-z]:/.test(relative) ||
    relative.includes('\\') ||
    relative.split('/').includes('..')
  )
    throw new Error('Artifact path must remain within its root');
  const root = realpathSync(artifactRoot);
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Artifact path escapes its root');
  let ancestor = target;
  while (true) {
    try {
      lstatSync(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  const actual = realpathSync(ancestor);
  if (actual !== root && !actual.startsWith(`${root}${path.sep}`))
    throw new Error('Artifact symlink escapes its root');
  return target;
}

export function assertPublicReceipt(
  value: unknown,
  artifactRoot: string,
  privateValues: readonly string[] = [],
): void {
  assertTestingDocument('public-receipt-v1', value);
  const row = value as {
    result: string;
    layer: string;
    startedAt: string;
    finishedAt: string;
    assertions: { id: string; evidencePaths: string[] }[];
    repositories: { name: string }[];
    artifacts: string[];
    cleanup: { recoveryRecordPath: string | null };
  };
  if (Date.parse(row.finishedAt) < Date.parse(row.startedAt))
    throw new Error('Receipt finishes before it starts');
  if (
    new Set(row.assertions.map((assertion) => assertion.id)).size !== row.assertions.length ||
    new Set(row.repositories.map((repository) => repository.name)).size !== row.repositories.length
  )
    throw new Error('Receipt contains duplicate identities');
  for (const relative of [
    ...row.artifacts,
    ...row.assertions.flatMap((assertion) => assertion.evidencePaths),
    ...(row.cleanup.recoveryRecordPath ? [row.cleanup.recoveryRecordPath] : []),
  ]) {
    const target = assertArtifactPath(artifactRoot, relative);
    if (
      (row.result === 'passed' ||
        (row.result === 'application-failed' && row.layer === 'native')) &&
      !existsSync(target)
    )
      throw new Error('Qualified receipt artifact is missing');
  }
  const serialized = JSON.stringify(value);
  if (
    /postgres(?:ql)?:\/\//i.test(serialized) ||
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(serialized) ||
    privateValues.some((secret) => secret.length > 0 && serialized.includes(secret))
  )
    throw new Error('Public receipt contains private data');
}
