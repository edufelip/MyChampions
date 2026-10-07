/* global Buffer, test */

const { readFile, rename, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const path = require('node:path');

const platform = process.env.DETOX_BASELINE_PLATFORM;
const role = process.env.DETOX_BASELINE_ROLE;
const artifactRoot = process.env.DETOX_BASELINE_ARTIFACT_ROOT;
const email = process.env.DETOX_BASELINE_EMAIL;
const password = process.env.DETOX_BASELINE_PASSWORD;
let retainedCancelCheckpoint;

if (!['ios', 'android'].includes(platform)) throw new Error('Detox baseline platform is missing');
if (!['student', 'professional'].includes(role)) throw new Error('Detox baseline role is missing');
if (!artifactRoot || !email || !password)
  throw new Error('Detox baseline private inputs are missing');

const landingMarker = role === 'student' ? 'student.home.screen' : 'pro.home.screen';

async function waitForId(id, timeout = 15000) {
  await waitFor(element(by.id(id)))
    .toBeVisible()
    .withTimeout(timeout);
}

async function openAccount() {
  await element(by.id('tabs.account')).tap();
  await waitForId('settings.account.screen');
}

// On Android the first tap on a still-coasting ScrollView only stops the fling.
// Tap, check the expected outcome, and tap once more if it did not happen.
async function tapAfterScroll(id, outcome) {
  await element(by.id(id)).tap();
  try {
    await outcome(2000);
  } catch {
    await element(by.id(id)).tap();
    await outcome(10000);
  }
}

async function scrollToSignOutConfirm() {
  await waitFor(element(by.id('settings.account.signOutConfirmCta')))
    .toBeVisible()
    .whileElement(by.id('settings.account.screen'))
    .scroll(240, 'down', 0.5, 0.5);
}

async function signIn() {
  await waitForId('auth.signIn.title');
  await element(by.id('auth.signIn.emailInput')).replaceText(email);
  await element(by.id('auth.signIn.passwordInput')).replaceText(password);
  await element(by.id('auth.signIn.submitButton')).tap();
  await waitForId(landingMarker, 20000);
}

async function launchFresh() {
  await device.launchApp({
    newInstance: true,
    launchArgs: { detoxEnableSynchronization: 0 },
  });
  await device.disableSynchronization();
}

async function writePrivate(name, value) {
  const file = path.join(artifactRoot, name);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
    flag: 'w',
    mode: 0o600,
  });
  await rename(temporary, file);
}

async function writePrivateBytes(name, bytes) {
  const file = path.join(artifactRoot, name);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, bytes, { flag: 'w', mode: 0o600 });
  await rename(temporary, file);
  return {
    name,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function captureCancelEvidence() {
  const hierarchy = Buffer.from(await device.generateViewHierarchyXml(true), 'utf8');
  const screenshotTemp = await device.takeScreenshot('detox-session-cancel-after-cancel');
  const screenshotBytes = await readFile(screenshotTemp);
  const hierarchyEvidence = await writePrivateBytes(
    'detox-cancel-after-cancel.private.xml',
    hierarchy,
  );
  const screenshotEvidence = await writePrivateBytes(
    'detox-cancel-after-cancel.private.png',
    screenshotBytes,
  );
  return {
    hierarchyFile: hierarchyEvidence.name,
    hierarchySha256: hierarchyEvidence.sha256,
    screenshotFile: screenshotEvidence.name,
    screenshotSha256: screenshotEvidence.sha256,
    modalPresent: false,
    accountScreenPresent: true,
  };
}

// Once published, the cancel checkpoint is immutable and must stay in every
// later progress write.
async function writeProgress(
  completedSteps,
  events,
  launchCount,
  cancelCheckpoint = retainedCancelCheckpoint,
) {
  await writePrivate('detox-session-progress.private.json', {
    schemaVersion: 2,
    kind: 'private-detox-session-progress',
    platform,
    role,
    completedSteps,
    events,
    launchCount,
    synchronizationDisabled: true,
    ...(cancelCheckpoint ? { cancelCheckpoint } : {}),
  });
}

async function recordStep(completedSteps, events, stepId, launchCount, details = {}) {
  const event = {
    stepId,
    ordinal: events.length + 1,
    monotonicMs: performance.now(),
    ...details,
  };
  completedSteps[stepId] = true;
  events.push(event);
  await writeProgress(Object.keys(completedSteps), events, launchCount);
  await waitForStepAck(stepId);
}

// The parent may force-stop the app to read a storage checkpoint for this
// step; do not touch the app again until it acknowledges the step.
async function waitForStepAck(stepId) {
  const file = path.join(artifactRoot, `detox-session-step-${stepId}.ack.private.json`);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (value?.stepId === stepId) return;
      throw new Error(`Detox session step ${stepId} acknowledgement is invalid`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Detox session step ${stepId} acknowledgement timed out`);
}

async function writeSteps(steps, events, launchCount) {
  await writePrivate('detox-session-result.private.json', {
    schemaVersion: 2,
    kind: 'private-detox-session-steps',
    platform,
    role,
    steps,
    events,
    launchCount,
    synchronizationDisabled: true,
  });
}

describe('owned integrated session baseline', () => {
  test('executes the locked-role six-assertion session', async () => {
    const steps = {};
    const events = [];
    let launchCount = 0;
    retainedCancelCheckpoint = undefined;

    await launchFresh();
    launchCount += 1;
    await signIn();

    // The server fixture already locks the role and accepted terms. A role
    // selection assertion here would make the real fixture contract false.
    await expect(element(by.id(landingMarker))).toBeVisible();
    await recordStep(steps, events, 'NAT-session-login', launchCount);

    await launchFresh();
    launchCount += 1;
    await waitForId(landingMarker);
    await recordStep(steps, events, 'NAT-session-restore', launchCount);

    await openAccount();
    await waitFor(element(by.id('settings.account.signOutCta')))
      .toBeVisible()
      .whileElement(by.id('settings.account.screen'))
      .scroll(260, 'down', 0.5, 0.5);
    await recordStep(steps, events, 'NAT-session-account', launchCount);
    await tapAfterScroll('settings.account.signOutCta', (timeout) =>
      waitFor(element(by.id('settings.account.signOutConfirm')))
        .toExist()
        .withTimeout(timeout),
    );
    await scrollToSignOutConfirm();
    await waitForId('settings.account.signOutConfirm');
    await tapAfterScroll('settings.account.signOutCancelCta', (timeout) =>
      waitFor(element(by.id('settings.account.signOutConfirm')))
        .not.toBeVisible()
        .withTimeout(timeout),
    );
    await waitForId('settings.account.screen');
    const cancelEvidence = await captureCancelEvidence();
    // Publish the cancellation boundary before confirmation. The parent reads the
    // actual native cache at this boundary and binds its UID hash to the restore.
    retainedCancelCheckpoint = {
      monotonicMs: performance.now(),
      cancelEvidence,
    };
    await writeProgress(Object.keys(steps), events, launchCount, retainedCancelCheckpoint);
    await waitForStepAck('cancel-checkpoint');

    await tapAfterScroll('settings.account.signOutCta', (timeout) =>
      waitFor(element(by.id('settings.account.signOutConfirm')))
        .toExist()
        .withTimeout(timeout),
    );
    await scrollToSignOutConfirm();
    await tapAfterScroll('settings.account.signOutConfirmCta', (timeout) =>
      waitForId('auth.signIn.title', timeout),
    );
    await recordStep(steps, events, 'NAT-session-signout', launchCount, {
      confirmationAfterCancel: 'not-visible',
      cancelEvidence,
    });

    await launchFresh();
    launchCount += 1;
    await waitForId('auth.signIn.title');
    await expect(element(by.id(landingMarker))).not.toBeVisible();
    await recordStep(steps, events, 'NAT-session-signed-out-relaunch', launchCount);

    // NAT-session-unrelated-state is SQL-only and is recorded by the parent
    // after its terminal owned Postgres snapshot, never by this UI child.
    await writeSteps(steps, events, launchCount);
  }, 300000);
});
