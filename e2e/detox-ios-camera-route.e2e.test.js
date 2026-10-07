/* global Buffer, __filename, test */

// This is an owned child entry for the private Detox camera route. It deliberately keeps
// credentials in process environment and keeps invite codes in memory only. The parent
// receives hashes and descriptor-backed frame receipts, never UI field contents.
const { createHash } = require('node:crypto');
const { system: detoxSystem } = require('detox');
const SYSTEM_PROMPT_BUDGET_MS = 120_000;
const SYSTEM_OBSERVATION_MAX_ATTEMPTS = 16;
const SYSTEM_OBSERVATION_ERROR_MAX_CHARS = 512;
const {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  readdir,
  rm,
  writeFile,
} = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const artifactRoot = path.resolve(process.env.DETOX_CAMERA_ARTIFACT_ROOT || '');
const currentRoot = path.resolve(process.env.DETOX_CAMERA_CURRENT_ROOT || '');
const detoxBaseConfigPath = process.env.DETOX_CAMERA_DETOX_BASE_CONFIG_PATH;
const detoxConfigPath = process.env.DETOX_CAMERA_DETOX_CONFIG_PATH;
const jestConfigPath = process.env.DETOX_CAMERA_JEST_CONFIG_PATH;
const cameraTestPath = process.env.DETOX_CAMERA_TEST_PATH;
const childSourcePath = process.env.DETOX_CAMERA_CHILD_SOURCE_PATH;
let expectedChildPid = Number(process.env.DETOX_CAMERA_EXPECTED_PID);
let expectedChildPgid = Number(process.env.DETOX_CAMERA_EXPECTED_PGID);
let expectedChildStartedAt = process.env.DETOX_CAMERA_EXPECTED_STARTED_AT || null;
const deadlineAt = Number(process.env.DETOX_CAMERA_DEADLINE_AT);
const studentEmail = process.env.DETOX_CAMERA_STUDENT_EMAIL;
const studentPassword = process.env.DETOX_CAMERA_STUDENT_PASSWORD;
const coachEmail = process.env.DETOX_CAMERA_COACH_EMAIL;
const coachPassword = process.env.DETOX_CAMERA_COACH_PASSWORD;
const runnerInputsExpectedSha256 = process.env.DETOX_CAMERA_RUNNER_INPUTS_SHA256;
const detoxBaseConfigExpectedSha256 = process.env.DETOX_CAMERA_DETOX_BASE_CONFIG_SHA256;
const detoxConfigExpectedSha256 = process.env.DETOX_CAMERA_DETOX_CONFIG_SHA256;
const jestConfigExpectedSha256 = process.env.DETOX_CAMERA_JEST_CONFIG_SHA256;
const cameraTestExpectedSha256 = process.env.DETOX_CAMERA_TEST_SHA256;
const childSourceExpectedSha256 = process.env.DETOX_CAMERA_CHILD_SOURCE_SHA256;
const sourceExpectedSha256 = process.env.DETOX_CAMERA_CHILD_SOURCE_SHA256;
const reviewedRunnerRoot = process.env.DETOX_CAMERA_REVIEWED_RUNNER_ROOT;
const reviewedRunnerInputsExpectedSha256 = process.env.DETOX_CAMERA_REVIEWED_RUNNER_INPUTS_SHA256;
const nodeModulesRoot = process.env.DETOX_CAMERA_NODE_MODULES_ROOT;
const workingRoot = process.env.DETOX_CAMERA_WORKING_ROOT;

if (
  !artifactRoot ||
  !Number.isFinite(deadlineAt) ||
  !studentEmail ||
  !studentPassword ||
  !coachEmail ||
  !coachPassword ||
  !currentRoot ||
  !detoxBaseConfigPath ||
  !detoxConfigPath ||
  !jestConfigPath ||
  !cameraTestPath ||
  !childSourcePath ||
  !runnerInputsExpectedSha256 ||
  !detoxBaseConfigExpectedSha256 ||
  !detoxConfigExpectedSha256 ||
  !jestConfigExpectedSha256 ||
  !cameraTestExpectedSha256 ||
  !childSourceExpectedSha256 ||
  !sourceExpectedSha256 ||
  !reviewedRunnerRoot ||
  !reviewedRunnerInputsExpectedSha256 ||
  !nodeModulesRoot ||
  !workingRoot
) {
  throw new Error('Detox camera child ownership/deadline/fixture inputs are incomplete');
}
if (
  !path.isAbsolute(reviewedRunnerRoot) ||
  reviewedRunnerRoot === currentRoot ||
  !/^[a-f0-9]{64}$/.test(reviewedRunnerInputsExpectedSha256) ||
  !path.isAbsolute(nodeModulesRoot) ||
  !path.isAbsolute(workingRoot)
) {
  throw new Error('Detox camera reviewed runner provenance is incomplete');
}

let actor = 'student';
let inviteCode;
let processed = new Set();
let stopping = false;
let bootstrapSeen = false;
let bootstrapCompleted = false;
let bootstrapStageToken;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function commandHash(command) {
  return sha256(Buffer.from(JSON.stringify({ ...command, commandHash: undefined })));
}
function childIdentity() {
  if (
    !Number.isSafeInteger(expectedChildPid) ||
    expectedChildPid <= 1 ||
    !Number.isSafeInteger(expectedChildPgid) ||
    expectedChildPgid <= 1 ||
    !expectedChildStartedAt
  )
    throw new Error('Detox camera child identity was not established');
  return {
    pid: expectedChildPid,
    pgid: expectedChildPgid,
    startedAt: expectedChildStartedAt,
  };
}
function assertLive() {
  if (Date.now() >= deadlineAt) throw new Error('Detox camera child deadline exceeded');
}
function assertWithinDeadline(limitAt, label) {
  assertLive();
  if (Date.now() >= limitAt) throw new Error(`Detox camera ${label} deadline exceeded`);
}
function systemPromptDeadlineAt(startedAt = Date.now()) {
  const anchorAt = Number(startedAt);
  if (!Number.isFinite(anchorAt))
    throw new Error('Invalid Detox camera system prompt budget anchor');
  return Math.min(deadlineAt, anchorAt + SYSTEM_PROMPT_BUDGET_MS);
}
function systemErrorDetails(error) {
  const details = {
    name: typeof error?.name === 'string' && error.name.length > 0 ? error.name : 'Error',
    message: String(error).slice(0, SYSTEM_OBSERVATION_ERROR_MAX_CHARS),
  };
  if (typeof error?.code === 'string' || typeof error?.code === 'number')
    details.code = String(error.code).slice(0, 64);
  return details;
}
function systemErrorChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current) && chain.length < 4) {
    seen.add(current);
    chain.push(systemErrorDetails(current));
    current = current.cause;
  }
  return chain;
}
function createSystemObservation(label, phaseLimitAt) {
  return {
    schema: 'detox-ios-camera-system-observation-v1',
    api: 'detox.system.element(by.system.label(label))',
    matcher: { type: 'label', value: label },
    lookup: {
      namespace: 'springboard',
      rootBundleIdentifier: 'com.apple.springboard',
      query: 'descendants(matching: .any).matching(identifier: value)',
      appUnderTestActivatedBeforeLookup: true,
      applicationConstraintSupported: false,
    },
    deadline: { originalDeadlineAt: deadlineAt, phaseLimitAt },
    attempts: [],
    omittedAttempts: 0,
    lastNativeError: null,
    terminalError: null,
  };
}
function combineSystemObservations(observations) {
  const lookups = observations.filter(Boolean);
  if (lookups.length === 1) return lookups[0];
  return {
    schema: 'detox-ios-camera-system-observation-v2',
    lookups,
    terminalError: null,
    terminalErrorChain: [],
  };
}
function recordSystemObservationAttempt(observation, attempt) {
  if (observation.attempts.length < SYSTEM_OBSERVATION_MAX_ATTEMPTS)
    observation.attempts.push(attempt);
  else observation.omittedAttempts += 1;
  if (attempt.error) observation.lastNativeError = attempt.error;
}
function attachSystemObservation(error, observation) {
  const observations = Array.isArray(observation) ? observation : [observation];
  const base = combineSystemObservations(observations);
  const decorated = {
    ...base,
    terminalError: systemErrorDetails(error),
    terminalErrorChain: systemErrorChain(error),
  };
  try {
    Object.defineProperty(error, 'detoxCameraSystemObservation', {
      configurable: true,
      enumerable: false,
      value: decorated,
      writable: false,
    });
    return error;
  } catch {
    const wrapped = new Error(String(error));
    wrapped.cause = error;
    wrapped.detoxCameraSystemObservation = decorated;
    return wrapped;
  }
}
async function runWithinDeadline(label, operation, limitAt = deadlineAt) {
  const boundedAt = Math.min(Number(limitAt), deadlineAt);
  if (!Number.isFinite(boundedAt)) throw new Error(`Invalid Detox camera ${label} deadline`);
  assertWithinDeadline(boundedAt, label);
  const remaining = boundedAt - Date.now();
  if (remaining < 1) throw new Error(`Detox camera ${label} deadline exceeded`);
  let timer;
  try {
    return await Promise.race([
      (async () => {
        assertWithinDeadline(boundedAt, label);
        const value = await operation();
        assertWithinDeadline(boundedAt, label);
        return value;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Detox camera ${label} deadline exceeded`)),
          Math.max(1, Math.floor(remaining)),
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
function attributeCandidates(attributes) {
  return Array.isArray(attributes?.elements) ? attributes.elements : [attributes];
}
function remainingDeadlineMs(limitAt) {
  return Math.min(limitAt, deadlineAt) - Date.now();
}
async function sleepWithinDeadline(limitAt) {
  const remaining = remainingDeadlineMs(limitAt);
  const sleepMs = Math.min(100, Math.floor(remaining));
  if (sleepMs < 1) return false;
  await runWithinDeadline(
    'poll sleep',
    () => new Promise((resolve) => setTimeout(resolve, sleepMs)),
    limitAt,
  );
  return true;
}
async function waitForActionableId(id, timeout = 90_000) {
  const timeoutMs = Number(timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    throw new Error(`Invalid Detox camera actionability timeout for ${id}`);
  const limitAt = Math.min(deadlineAt, Date.now() + timeoutMs);
  let previousFrame;
  let stableSamples = 0;
  let lastAttributes;
  let lastError;
  while (Date.now() < limitAt) {
    assertLive();
    try {
      lastAttributes = await runWithinDeadline(
        `actionability observation for ${id}`,
        () => element(by.id(id)).getAttributes(),
        limitAt,
      );
      const candidate = attributeCandidates(lastAttributes).find(
        (attributes) =>
          attributes?.enabled === true &&
          attributes?.visible === true &&
          attributes?.hittable === true,
      );
      const frame = candidate?.frame ?? candidate?.elementFrame;
      if (candidate && frame !== undefined) {
        const frameKey = JSON.stringify(frame);
        stableSamples = frameKey === previousFrame ? stableSamples + 1 : 1;
        previousFrame = frameKey;
        if (stableSamples >= 2) return candidate;
      } else {
        previousFrame = undefined;
        stableSamples = 0;
      }
    } catch (error) {
      lastError = error;
      previousFrame = undefined;
      stableSamples = 0;
    }
    if (!(await sleepWithinDeadline(limitAt))) break;
  }
  assertLive();
  throw new Error(
    `Detox camera element ${id} did not become enabled, visible, hittable and stable before its deadline: ${JSON.stringify(
      { lastAttributes, lastError: lastError ? String(lastError) : undefined },
    )}`,
  );
}
async function waitForSystemElementExists(
  labels,
  timeout = SYSTEM_PROMPT_BUDGET_MS,
  budgetLimitAt = systemPromptDeadlineAt(),
) {
  const candidates = Array.isArray(labels) ? labels : [labels];
  if (candidates.length === 0 || candidates.some((label) => typeof label !== 'string' || !label))
    throw new Error('Detox camera system prompt labels are incomplete');
  const timeoutMs = Number(timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    throw new Error('Invalid Detox camera system prompt timeout');
  const requestedLimitAt = Number(budgetLimitAt);
  if (!Number.isFinite(requestedLimitAt))
    throw new Error('Invalid Detox camera system prompt budget deadline');
  const limitAt = Math.min(deadlineAt, requestedLimitAt, Date.now() + timeoutMs);
  const observation = createSystemObservation(candidates[0], limitAt);
  let lastError;
  while (Date.now() < limitAt) {
    assertLive();
    for (const label of candidates) {
      const startedAt = Date.now();
      const attempt = {
        index: observation.attempts.length + observation.omittedAttempts + 1,
        label,
        startedAt,
      };
      let target;
      try {
        target = detoxSystem.element(by.system.label(label));
        await runWithinDeadline(
          `system prompt observation for ${label}`,
          () => expect(target).toExist(),
          limitAt,
        );
        const endedAt = Date.now();
        recordSystemObservationAttempt(observation, {
          ...attempt,
          endedAt,
          elapsedMs: Math.max(0, endedAt - startedAt),
          outcome: 'present',
        });
        const result = { label, target };
        Object.defineProperty(result, 'systemObservation', {
          configurable: false,
          enumerable: false,
          value: observation,
          writable: false,
        });
        return result;
      } catch (error) {
        const endedAt = Date.now();
        const absent = isOptionalSystemPromptAbsent(error);
        const errorDetails = {
          ...systemErrorDetails(error),
          errorChain: systemErrorChain(error),
        };
        recordSystemObservationAttempt(observation, {
          ...attempt,
          endedAt,
          elapsedMs: Math.max(0, endedAt - startedAt),
          outcome: absent ? 'recognized-absent' : 'error',
          error: errorDetails,
        });
        if (!absent) throw attachSystemObservation(error, observation);
        lastError = error;
      }
      try {
        assertLive();
      } catch (error) {
        throw attachSystemObservation(error, observation);
      }
    }
    try {
      if (!(await sleepWithinDeadline(limitAt))) break;
    } catch (error) {
      throw attachSystemObservation(error, observation);
    }
  }
  try {
    assertLive();
  } catch (error) {
    throw attachSystemObservation(error, observation);
  }
  const timeoutError = new Error(
    `Detox camera system element did not exist before its deadline: ${JSON.stringify({ candidates, lastError: lastError ? String(lastError).slice(0, 240) : undefined })}`,
  );
  throw attachSystemObservation(timeoutError, observation);
}
function isOptionalSystemPromptAbsent(error) {
  const message = String(error);
  if (/cancel|abort|deadline|timed? ?out|timeout/i.test(message)) return false;
  return (
    /to exist|exist|element|match/i.test(message) &&
    /does not|doesn't|did not|not found|no (?:matching )?elements? found|no (?:matching )?element|could not find|unable to find/i.test(
      message,
    )
  );
}
function inputMetadata(value) {
  return {
    mode: Number(value.mode) & 0o777,
    uid: Number(value.uid),
    gid: Number(value.gid),
    dev: Number(value.dev),
    ino: Number(value.ino),
    nlink: Number(value.nlink),
    size: Number(value.size),
    mtimeMs: Number(value.mtimeMs),
    ctimeMs: Number(value.ctimeMs),
  };
}
function sameInputMetadata(left, right) {
  return (
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}
function requireCanonicalRunnerPath(file, relativePath) {
  const expected = path.join(currentRoot, relativePath);
  if (
    !path.isAbsolute(file) ||
    path.resolve(file) !== expected ||
    path.relative(currentRoot, file).startsWith(`..${path.sep}`)
  )
    throw new Error(`Detox camera runner closure escaped its owned root: ${relativePath}`);
  return expected;
}
function verifyDetoxIosProfileBinding() {
  let config;
  try {
    config = require(detoxConfigPath);
  } catch {
    throw new Error('Detox camera staged config could not be loaded');
  }
  const binaryPath = config?.apps?.['ios.debug']?.binaryPath;
  const checkedInDefault = 'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app';
  const expectedProfilePath = path.join(reviewedRunnerRoot, checkedInDefault);
  const reusedBinaryPath = process.env.DETOX_IOS_VERIFIED_BINARY_PATH;
  const profilePath = process.env.DETOX_IOS_VERIFIED_BINARY_PROFILE_PATH;
  if (reusedBinaryPath !== undefined) {
    if (profilePath !== expectedProfilePath || binaryPath !== reusedBinaryPath)
      throw new Error('Detox camera reused binary is not bound to the Q checked-in profile');
  } else if (binaryPath !== checkedInDefault) {
    throw new Error('Detox camera binary is not bound to the Q checked-in profile');
  }
}
async function readOwnedRunnerInput(key, file, relativePath, expectedSha256) {
  assertLive();
  const expected = requireCanonicalRunnerPath(file, relativePath);
  if ((await realpath(expected)) !== expected)
    throw new Error(`Detox camera runner input is not canonical: ${key}`);
  const before = await lstat(expected);
  const beforeMetadata = inputMetadata(before);
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (uid !== undefined && before.uid !== uid) ||
    before.nlink !== 1 ||
    (before.mode & 0o022) !== 0 ||
    before.size > 1024 * 1024
  )
    throw new Error(`Detox camera runner input is not a private file: ${key}`);
  const bytes = await readFile(expected);
  assertLive();
  const after = await lstat(expected);
  const afterMetadata = inputMetadata(after);
  if (!sameInputMetadata(beforeMetadata, afterMetadata) || bytes.length !== after.size)
    throw new Error(`Detox camera runner input changed while being verified: ${key}`);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256)
    throw new Error(`Detox camera runner input hash changed: ${key}`);
  return {
    key,
    path: expected,
    relativePath,
    sha256: actualSha256,
    bytes: bytes.length,
    ...afterMetadata,
  };
}
async function verifyRunnerInputs() {
  assertLive();
  if ((await realpath(currentRoot)) !== currentRoot)
    throw new Error('Detox camera runner root is not canonical at child launch');
  if (
    workingRoot !== reviewedRunnerRoot ||
    path.resolve(process.cwd()) !== reviewedRunnerRoot ||
    nodeModulesRoot !== path.join(reviewedRunnerRoot, 'node_modules') ||
    process.env.NODE_PATH !== nodeModulesRoot
  )
    throw new Error('Detox camera child module resolution or working root drifted');
  let detoxModulePath;
  try {
    detoxModulePath = require.resolve('detox');
  } catch {
    throw new Error('Detox camera child cannot resolve Detox from the owned Q node_modules');
  }
  const detoxModuleRelative = path.relative(nodeModulesRoot, detoxModulePath);
  if (
    !detoxModuleRelative ||
    detoxModuleRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(detoxModuleRelative)
  )
    throw new Error('Detox camera child resolved Detox outside the owned Q node_modules');
  verifyDetoxIosProfileBinding();
  const rootMetadata = await lstat(currentRoot);
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    (uid !== undefined && rootMetadata.uid !== uid) ||
    (rootMetadata.mode & 0o022) !== 0
  )
    throw new Error('Detox camera runner root is not a directory at child launch');
  const specs = [
    ['detoxBaseConfigPath', detoxBaseConfigPath, '.detoxrc.js', detoxBaseConfigExpectedSha256],
    [
      'detoxConfigPath',
      detoxConfigPath,
      'detox.camera.private.config.js',
      detoxConfigExpectedSha256,
    ],
    [
      'jestConfigPath',
      jestConfigPath,
      'jest.detox-camera.private.config.js',
      jestConfigExpectedSha256,
    ],
    [
      'cameraTestPath',
      cameraTestPath,
      'e2e/detox-ios-camera-route.e2e.test.js',
      cameraTestExpectedSha256,
    ],
    [
      'childSourcePath',
      childSourcePath,
      'e2e/detox-ios-camera-route.e2e.test.js',
      childSourceExpectedSha256,
    ],
  ];
  const files = [];
  for (const [key, file, relativePath, expectedSha256] of specs)
    files.push(await readOwnedRunnerInput(key, file, relativePath, expectedSha256));
  const actualAggregateSha256 = sha256(Buffer.from(JSON.stringify({ root: currentRoot, files })));
  if (actualAggregateSha256 !== runnerInputsExpectedSha256)
    throw new Error('Detox camera runner closure changed before child launch');
  return { root: currentRoot, files, sha256: actualAggregateSha256 };
}
function insideRoot(file) {
  const resolved = path.resolve(file);
  const rel = path.relative(artifactRoot, resolved);
  if (rel.startsWith('..') || rel.includes(`${path.sep}..${path.sep}`))
    throw new Error('Detox camera child path escaped artifact root');
  return resolved;
}
async function privateRead(file, maxBytes = 512 * 1024) {
  const resolved = insideRoot(file);
  const before = await lstat(resolved);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    (before.mode & 0o777) !== 0o600 ||
    before.size > maxBytes
  )
    throw new Error('Detox camera child input is not a bounded private file');
  const bytes = await readFile(resolved);
  const after = await lstat(resolved);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  )
    throw new Error('Detox camera child input changed while reading');
  return bytes;
}
async function privateWrite(name, bytes) {
  const destination = insideRoot(path.join(artifactRoot, name));
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Detox camera child output is too large');
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  await chmod(destination, 0o600);
  const metadata = await lstat(destination);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size !== bytes.length
  )
    throw new Error('Detox camera child output identity changed');
  return {
    path: destination,
    sha256: sha256(bytes),
    bytes: bytes.length,
    mode: metadata.mode & 0o777,
  };
}
async function verifySource() {
  if (path.resolve(__filename) !== path.resolve(childSourcePath))
    throw new Error('Detox camera child source path changed after parent validation');
  const bytes = await readFile(__filename);
  if (sha256(bytes) !== sourceExpectedSha256)
    throw new Error('Detox camera child source changed after parent validation');
}
async function waitForId(id, timeout = 90_000) {
  await waitFor(element(by.id(id)))
    .toBeVisible()
    .withTimeout(timeout);
}
async function tapId(id) {
  await waitForActionableId(id);
  await runWithinDeadline(`tap for ${id}`, () => element(by.id(id)).tap());
}
async function signIn(email, password, landing) {
  await waitForId('auth.signIn.title');
  await element(by.id('auth.signIn.emailInput')).replaceText(email);
  await element(by.id('auth.signIn.passwordInput')).replaceText(password);
  await tapId('auth.signIn.submitButton');
  await waitForId(landing, 90_000);
}
async function launchFresh() {
  await device.launchApp({
    newInstance: true,
    launchArgs: { detoxEnableSynchronization: 0 },
  });
  await device.disableSynchronization();
}
async function signOut() {
  await tapId('tabs.account');
  await tapId('settings.account.signOutCta');
  await tapId('settings.account.signOutConfirmCta');
  await waitForId('auth.signIn.title');
}
async function switchAccount(next) {
  if (actor === next) return;
  await signOut();
  if (next === 'student') await signIn(studentEmail, studentPassword, 'student.home.screen');
  else await signIn(coachEmail, coachPassword, 'pro.home.screen');
  actor = next;
}
async function writeFrame(label, viewId, frameActor, semanticState, prompt) {
  assertLive();
  const xml = Buffer.from(
    await runWithinDeadline('frame hierarchy capture', () => device.generateViewHierarchyXml(true)),
    'utf8',
  );
  const screenshotPath = await runWithinDeadline('frame screenshot capture', () =>
    device.takeScreenshot(`detox-camera-${label}`),
  );
  const screenshotBytes = await runWithinDeadline('frame screenshot read', () =>
    readFile(screenshotPath),
  );
  if (
    screenshotBytes.length < 8 ||
    screenshotBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
  )
    throw new Error('Detox camera screenshot is not PNG bytes');
  const hierarchy = await runWithinDeadline('frame hierarchy write', () =>
    privateWrite(`${label}.private.xml`, xml),
  );
  const screenshot = await runWithinDeadline('frame screenshot write', () =>
    privateWrite(`${label}.private.png`, screenshotBytes),
  );
  const command = await runWithinDeadline('frame command write', () =>
    privateWrite(
      `${label}.private.command.json`,
      Buffer.from(
        JSON.stringify({
          label,
          viewId,
          actor: frameActor,
          semanticState,
          producer: 'detox.device',
        }),
      ),
    ),
  );
  return {
    label,
    actor: frameActor,
    viewId,
    hierarchy: { ...hierarchy, sourceKind: 'owned-detox-hierarchy' },
    screenshot: { ...screenshot, sourceKind: 'owned-detox-screenshot' },
    command: { ...command, sourceKind: 'owned-detox-command' },
    semanticState,
    ...(semanticState === 'coach-invite' && inviteCode
      ? { inviteCodeSha256: sha256(Buffer.from(inviteCode)) }
      : {}),
    ...(prompt ? { systemPrompt: prompt } : {}),
  };
}
async function cameraObserve(command) {
  const { semanticState, viewId, label } = command;
  if (semanticState === 'camera-entry') {
    await tapId('student.home.accountButton');
    await waitForId('student.professionals.screen');
    await waitForId('student.professionals.scanQrButton');
  } else if (semanticState === 'camera-prompt') {
    await tapId('student.professionals.scanQrButton');
    await waitForSystemElementExists('Allow', SYSTEM_PROMPT_BUDGET_MS, systemPromptDeadlineAt());
  } else if (semanticState === 'camera-guidance') {
    await waitForId('student.professionals.screen');
  } else if (semanticState === 'coach-invite') {
    await waitForId('pro.home.screen');
    const attrs = await element(by.id('pro.home.inviteCodeValue')).getAttributes();
    inviteCode = typeof attrs?.text === 'string' && attrs.text.length > 0 ? attrs.text : undefined;
    if (!inviteCode)
      throw new Error('Detox camera coach invite UI did not expose a nonempty value');
  } else if (semanticState === 'student-entry') {
    await tapId('student.home.accountButton');
    await waitForId('student.professionals.codeInput');
  } else if (semanticState === 'pending') {
    await waitForId('student.professionals.screen');
  } else {
    throw new Error(`Unsupported Detox camera semantic observation ${semanticState}`);
  }
  return writeFrame(
    label,
    viewId,
    actor,
    semanticState,
    semanticState === 'camera-prompt' ? { visible: true, action: 'request-camera' } : undefined,
  );
}
async function denyCamera() {
  assertLive();
  const budgetLimitAt = systemPromptDeadlineAt();
  const control = await waitForSystemElementExists(
    ['Don’t Allow', "Don't Allow"],
    SYSTEM_PROMPT_BUDGET_MS,
    budgetLimitAt,
  );
  await runWithinDeadline(
    'camera permission denial tap',
    () => control.target.tap(),
    budgetLimitAt,
  );
  return { ok: true, permission: 'denied', promptControl: control.label };
}
async function submitManual() {
  if (!inviteCode) throw new Error('Detox camera manual submit has no in-memory coach invite');
  await element(by.id('student.professionals.codeInput')).replaceText(inviteCode);
  await tapId('student.professionals.connectButton');
  await waitForId('student.professionals.screen');
  return { ok: true };
}
async function execute(command) {
  assertLive();
  await verifyRunnerInputs();
  if (command.kind === 'bootstrap') {
    if (bootstrapSeen) throw new Error('Detox camera bootstrap was already handled');
    bootstrapSeen = true;
    bootstrapStageToken = command.commandHash;
    await launchFresh();
    await signIn(studentEmail, studentPassword, 'student.home.screen');
    actor = 'student';
    return {
      ok: true,
      readiness: {
        schema: 'detox-ios-camera-bootstrap-pending-v1',
        actor: 'student',
        landingId: 'student.home.screen',
        launch: 'fresh',
        authenticated: true,
        cameraReady: false,
        landingObservation: {
          id: 'student.home.screen',
          source: 'detox-child',
          phase: 'bootstrap-pending',
        },
        passwordSavePrompt: {
          status: 'pending',
          stage: 'owner-remote-service-helper',
          stageToken: command.commandHash,
        },
      },
    };
  }
  if (command.kind === 'complete-bootstrap') {
    if (!bootstrapSeen) throw new Error('Detox camera prompt stage arrived before bootstrap');
    if (bootstrapCompleted) throw new Error('Detox camera bootstrap was already completed');
    if (command.promptStatus !== 'dismissed' && command.promptStatus !== 'absent')
      throw new Error('Detox camera prompt completion status is invalid');
    if (command.bootstrapStageToken !== bootstrapStageToken)
      throw new Error('Detox camera prompt completion stage token does not match bootstrap');
    if (!/^[a-f0-9]{64}$/.test(command.promptReceiptSha256 || ''))
      throw new Error('Detox camera prompt completion receipt hash is invalid');
    if (!/^[a-f0-9]{64}$/.test(command.promptCommandReceiptSha256 || ''))
      throw new Error('Detox camera prompt completion receipt hash is invalid');
    await runWithinDeadline(
      'final signed-in landing assertion',
      () =>
        waitForId(
          'student.home.screen',
          Math.max(1, Math.min(90_000, remainingDeadlineMs(deadlineAt))),
        ),
      deadlineAt,
    );
    bootstrapCompleted = true;
    return {
      ok: true,
      readiness: {
        schema: 'detox-ios-camera-bootstrap-ready-v1',
        actor: 'student',
        landingId: 'student.home.screen',
        launch: 'fresh',
        authenticated: true,
        cameraReady: true,
        landingObservation: {
          id: 'student.home.screen',
          source: 'detox-child',
          phase: 'bootstrap-complete',
        },
        passwordSavePrompt: {
          status: command.promptStatus,
          source: 'owner-remote-service-helper',
          targetBundleIdentifier: 'com.apple.SafariViewService',
          promptLabel: 'Save Password?',
          dismissLabel: 'Not Now',
          stageToken: command.bootstrapStageToken,
          receiptSha256: command.promptReceiptSha256,
          commandReceiptSha256: command.promptCommandReceiptSha256,
        },
      },
    };
  }
  if (!bootstrapCompleted && command.kind !== 'shutdown')
    throw new Error('Detox camera child command arrived before protected bootstrap completion');
  if (command.kind === 'switch-account') {
    await switchAccount(command.actor);
    return { ok: true };
  }
  if (command.kind === 'observe') return { ok: true, frame: await cameraObserve(command) };
  if (command.kind === 'deny-camera') return denyCamera();
  if (command.kind === 'submit-manual') return submitManual();
  if (command.kind === 'shutdown') return { ok: true };
  throw new Error(`Unsupported Detox camera child command ${command.kind}`);
}
function failureErrorDetails(error) {
  const details = {
    name: typeof error?.name === 'string' && error.name.length > 0 ? error.name : 'Error',
    message: String(error).slice(0, 240),
  };
  if (error?.detoxCameraSystemObservation)
    details.systemObservation = error.detoxCameraSystemObservation;
  return details;
}
async function captureFailureEvidence(command, originalError) {
  const token = sha256(Buffer.from(`${command.commandId}:${command.commandHash}`)).slice(0, 24);
  const captureLimitAt = Math.min(deadlineAt, Date.now() + 5_000);
  const evidence = {
    schema: 'detox-ios-camera-failure-evidence-v1',
    commandId: command.commandId,
    originalError: failureErrorDetails(originalError),
    systemObservation: null,
    hierarchy: null,
    screenshot: null,
    errors: [],
  };
  if (originalError?.detoxCameraSystemObservation) {
    try {
      evidence.systemObservation = await runWithinDeadline(
        'failure system observation write',
        () =>
          privateWrite(
            `detox-camera-system-observation-${token}.private.json`,
            Buffer.from(JSON.stringify(originalError.detoxCameraSystemObservation)),
          ),
        captureLimitAt,
      );
    } catch (error) {
      evidence.errors.push({
        stage: 'system-observation',
        ...failureErrorDetails(error),
      });
    }
  }
  try {
    assertWithinDeadline(captureLimitAt, 'failure hierarchy capture');
    const xml = Buffer.from(
      await runWithinDeadline(
        'failure hierarchy capture',
        () => device.generateViewHierarchyXml(true),
        captureLimitAt,
      ),
      'utf8',
    );
    if (xml.length === 0) throw new Error('Detox camera failure hierarchy was empty');
    evidence.hierarchy = await runWithinDeadline(
      'failure hierarchy write',
      () => privateWrite(`detox-camera-failure-${token}.private.xml`, xml),
      captureLimitAt,
    );
  } catch (error) {
    evidence.errors.push({ stage: 'hierarchy', ...failureErrorDetails(error) });
  }
  try {
    assertWithinDeadline(captureLimitAt, 'failure screenshot capture');
    const screenshotPath = await runWithinDeadline(
      'failure screenshot capture',
      () => device.takeScreenshot(`detox-camera-failure-${token}`),
      captureLimitAt,
    );
    const screenshot = await runWithinDeadline(
      'failure screenshot read',
      () => readFile(screenshotPath),
      captureLimitAt,
    );
    if (screenshot.length < 8 || screenshot.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
      throw new Error('Detox camera failure screenshot was not PNG bytes');
    evidence.screenshot = await runWithinDeadline(
      'failure screenshot write',
      () => privateWrite(`detox-camera-failure-${token}.private.png`, screenshot),
      captureLimitAt,
    );
  } catch (error) {
    evidence.errors.push({
      stage: 'screenshot',
      ...failureErrorDetails(error),
    });
  }
  evidence.status =
    evidence.hierarchy && evidence.screenshot
      ? 'complete'
      : evidence.hierarchy || evidence.screenshot
        ? 'partial'
        : 'unknown';
  return evidence;
}
async function respond(command, result) {
  const response = {
    schema: 'detox-ios-camera-response-v1',
    commandId: command.commandId,
    commandHash: command.commandHash,
    child: childIdentity(),
    ...result,
  };
  await privateWrite(
    `detox-camera-response-${command.commandId}.private.json`,
    Buffer.from(JSON.stringify(response)),
  );
}
async function poll() {
  if (stopping) return;
  await verifySource();
  const names = (await readdir(artifactRoot))
    .filter((name) => name.startsWith('detox-camera-command-') && name.endsWith('.private.json'))
    .sort();
  for (const name of names) {
    if (processed.has(name)) continue;
    const command = JSON.parse((await privateRead(path.join(artifactRoot, name))).toString('utf8'));
    if (
      !command ||
      !Number.isSafeInteger(command.child?.pid) ||
      command.child.pid <= 1 ||
      !Number.isSafeInteger(command.child?.pgid) ||
      command.child.pgid <= 1 ||
      typeof command.child?.startedAt !== 'string' ||
      command.child.startedAt.length === 0
    )
      throw new Error('Detox camera child command identity mismatch');
    if (!Number.isSafeInteger(expectedChildPid)) expectedChildPid = command.child.pid;
    if (!Number.isSafeInteger(expectedChildPgid)) expectedChildPgid = command.child.pgid;
    if (command.child.pid !== expectedChildPid || command.child.pgid !== expectedChildPgid)
      throw new Error('Detox camera child command process identity changed');
    if (expectedChildStartedAt === null) expectedChildStartedAt = command.child.startedAt;
    if (command.child.startedAt !== expectedChildStartedAt)
      throw new Error('Detox camera child command start identity changed');
    if (typeof command.commandHash !== 'string' || command.commandHash !== commandHash(command))
      throw new Error('Detox camera child command hash mismatch');
    processed.add(name);
    try {
      await respond(command, await execute(command));
    } catch (error) {
      const failureEvidence = await captureFailureEvidence(command, error);
      await respond(command, {
        ok: false,
        error: {
          code: /cancel|abort/i.test(String(error)) ? 'cancelled' : 'failed',
          message: String(error).slice(0, 240),
        },
        failureEvidence,
      });
    }
    if (command.kind === 'shutdown') {
      stopping = true;
      setImmediate(() => process.exit(0));
    }
  }
}

test('detox iOS camera owned child', async () => {
  await verifySource();
  await verifyRunnerInputs();
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  // This receipt is published only after Jest has discovered and entered the
  // one reviewed camera test. The owner uses it to reject a no-test runner
  // before sending the first bootstrap command.
  await privateWrite(
    'detox-camera-jest-selection.private.json',
    Buffer.from(
      JSON.stringify({
        schema: 'detox-ios-camera-jest-selection-v1',
        phase: 'module-executed',
        moduleLoaded: true,
        runnerInputsSha256: runnerInputsExpectedSha256,
        cameraTestPath,
        cameraTestSha256: cameraTestExpectedSha256,
        selectedTestCount: 1,
      }),
    ),
  );
  while (!stopping) {
    await poll();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
});
