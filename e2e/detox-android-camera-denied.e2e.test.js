/* global Buffer */

const { createHash } = require('node:crypto');
const path = require('node:path');
const { readFile } = require('node:fs/promises');

let protocolModule;
async function protocol() {
  protocolModule ??= import('../scripts/testing/detox-training-child-protocol.mjs');
  return protocolModule;
}

const platform = process.env.DETOX_CONNECTION_PLATFORM;
const artifactRoot = process.env.DETOX_ANDROID_CAMERA_ARTIFACT_ROOT;
const coachEmail = process.env.DETOX_ANDROID_CAMERA_COACH_EMAIL;
const coachPassword = process.env.DETOX_ANDROID_CAMERA_COACH_PASSWORD;
const studentEmail = process.env.DETOX_ANDROID_CAMERA_STUDENT_EMAIL;
const studentPassword = process.env.DETOX_ANDROID_CAMERA_STUDENT_PASSWORD;
const appId = 'com.edufelip.mychampions.dev';

if (platform !== 'android') throw new Error('Android Detox camera platform is missing');
if (!artifactRoot || !coachEmail || !coachPassword || !studentEmail || !studentPassword)
  throw new Error('Owned Android camera fixture credentials are missing');

const profile = {
  signInTitle: 'auth.signIn.title',
  signInEmail: 'auth.signIn.emailInput',
  signInPassword: 'auth.signIn.passwordInput',
  signInSubmit: 'auth.signIn.submitButton',
  coachHome: 'pro.home.screen',
  studentHome: 'student.home.screen',
  accountTab: 'tabs.account',
  signOut: 'settings.account.signOutCta',
  signOutConfirm: 'settings.account.signOutConfirmCta',
  studentEntry: 'student.home.accountButton',
  professionals: 'student.professionals.screen',
  scan: 'student.professionals.scanQrButton',
  qrModal: 'student.professionals.qrModal',
  error: 'student.professionals.submitError',
  codeInput: 'student.professionals.codeInput',
  connect: 'student.professionals.connectButton',
  pendingPrefix: 'student.professionals.connectionPending.',
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function waitForId(id, timeout = 90_000) {
  try {
    await waitFor(element(by.id(id)))
      .toBeVisible()
      .withTimeout(timeout);
  } catch (error) {
    await device.takeScreenshot(`camera-wait-${id.replace(/[^a-z0-9]+/gi, '-')}`);
    throw error;
  }
}

async function signIn(email, password, landing) {
  await waitForId(profile.signInTitle);
  await element(by.id(profile.signInEmail)).replaceText(email);
  await element(by.id(profile.signInPassword)).replaceText(password);
  await element(by.id(profile.signInSubmit)).tap();
  await waitForId(landing);
}

async function signOutForNextActor() {
  await element(by.id(profile.accountTab)).tap();
  await waitForId(profile.signOut);
  await element(by.id(profile.signOut)).tap();
  await waitFor(element(by.id(profile.signOutConfirm)))
    .toBeVisible()
    .whileElement(by.id('settings.account.screen'))
    .scroll(260, 'down', 0.5, 0.5);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await element(by.id(profile.signOutConfirm)).tap();
    try {
      await waitFor(element(by.id(profile.signOutConfirm)))
        .not.toBeVisible()
        .withTimeout(5_000);
      break;
    } catch (error) {
      if (attempt === 1) throw error;
      await waitFor(element(by.id(profile.signOutConfirm)))
        .toBeVisible()
        .whileElement(by.id('settings.account.screen'))
        .scroll(160, 'down', 0.5, 0.5);
    }
  }
  await waitForId(profile.signInTitle);
}

function attributeText(attributes) {
  return attributes?.accessibilityText || attributes?.text || attributes?.value || '';
}

async function ownedInviteCode() {
  await waitForId(profile.coachHome);
  const attributes = await element(by.id('pro.home.inviteCodeValue')).getAttributes();
  const value = String(attributeText(attributes));
  const match = /(?:^|: )([A-F0-9]{8})$/u.exec(value);
  if (!match) throw new Error('Owned coach invite code was not present in the native hierarchy');
  return match[1];
}

async function pendingConnectionId() {
  const xml = String(await device.generateViewHierarchyXml(true));
  const matches = [
    ...xml.matchAll(/student\.professionals\.connectionPending\.([a-f0-9-]{36})/giu),
  ].map((match) => match[1]);
  const unique = [...new Set(matches)];
  if (unique.length !== 1)
    throw new Error('Owned Android camera pending connection identity was missing or ambiguous');
  return unique[0];
}

async function publishFlowReceipt(value) {
  const p = await protocol();
  await p.writeAtomicTrainingJson(artifactRoot, 'detox-training-camera-flow.private.json', value);
}

const stageNames = new Set([
  'launched',
  'coach-signed-in',
  'coach-signed-out',
  'student-signed-in',
  'camera-requested',
  'manual-entry-ready',
  'submit-intent-published',
  'connection-submitted',
  'pending-observed',
]);
let stageSequence = 0;

async function publishStage(stage) {
  if (!stageNames.has(stage)) throw new Error('Android camera stage is unsupported');
  const p = await protocol();
  stageSequence += 1;
  await p.writeAtomicTrainingJson(
    artifactRoot,
    `detox-training-camera-stage-${String(stageSequence).padStart(2, '0')}.private.json`,
    {
    kind: 'private-owned-android-detox-camera-stage',
    schemaVersion: 1,
    captureRunId: process.env.DETOX_ANDROID_CAMERA_CAPTURE_RUN_ID,
    ownerRunId: process.env.DETOX_ANDROID_CAMERA_OWNER_RUN_ID,
    attemptId: process.env.DETOX_ANDROID_CAMERA_ATTEMPT_ID,
    sequence: stageSequence,
    stage,
    },
  );
}

async function publishSourceFrame(label, selector) {
  const p = await protocol();
  const xml = String(await device.generateViewHierarchyXml(true));
  if (!xml) throw new Error(`Detox hierarchy producer returned no XML for ${label}`);
  const xmlName = `detox-training-camera-${label}.xml`;
  await p.writeAtomicTrainingBytes(artifactRoot, xmlName, Buffer.from(xml), p.MAX_XML_BYTES);
  const attributes = await element(by.id(selector)).getAttributes();
  const attributesName = `detox-training-camera-${label}-attributes.private.json`;
  await p.writeAtomicTrainingJson(artifactRoot, attributesName, {
    kind: 'private-detox-camera-original-attributes',
    producer: 'detox.element.getAttributes',
    selector,
    attributesSha256: p.hashJson(attributes),
    actionable: attributes?.enabled === true && attributes?.visible !== false,
  });
  const screenshotPath = await device.takeScreenshot(`detox-training-camera-${label}`);
  if (typeof screenshotPath !== 'string' || !path.isAbsolute(screenshotPath))
    throw new Error(`Detox screenshot producer returned no path for ${label}`);
  const original = await p.readOwnedTrainingPath(screenshotPath, p.MAX_SCREENSHOT_BYTES);
  const screenshotName = `detox-training-camera-${label}.png`;
  await p.writeAtomicTrainingBytes(
    artifactRoot,
    screenshotName,
    original.bytes,
    p.MAX_SCREENSHOT_BYTES,
  );
  return {
    label,
    selector,
    hierarchyPath: xmlName,
    hierarchySha256: p.hashBytes(Buffer.from(xml)),
    attributesPath: attributesName,
    attributesSha256: p.hashJson(attributes),
    screenshotPath: screenshotName,
    screenshotSha256: p.hashBytes(original.bytes),
    originalScreenshotPath: original.realpath,
    originalScreenshotSha256: p.hashBytes(original.bytes),
  };
}

const enabled = process.env.DETOX_ANDROID_CAMERA_SCENARIO === 'denied';
const describeCamera = enabled ? describe : describe.skip;

function cameraLaunchArgs() {
  // Android instrumentation has already received the owned bridge arguments
  // from .detoxrc.js before Jest begins. A later Android launch only resumes
  // the activity, so it must not claim to reconfigure that immutable bridge.
  return { detoxEnableSynchronization: 0 };
}

async function launchCameraApp(resetAppState = false) {
  // Android attached runs have no app connection until the test explicitly
  // launches the activity. Keep this first command before every Detox invoke.
  await device.launchApp({
    newInstance: true,
    ...(resetAppState ? { resetAppState: true } : {}),
    launchArgs: cameraLaunchArgs(),
  });
  await device.disableSynchronization();
}

describeCamera('owned Android Detox camera denied flow', () => {
  beforeEach(async () => {
    await launchCameraApp();
    await publishStage('launched');
  });

  it('uses owned fixture auth and runtime identities for the complete camera journey', async () => {
    await signIn(coachEmail, coachPassword, profile.coachHome);
    await publishStage('coach-signed-in');
    const coachFrame = await publishSourceFrame('coach-home', profile.coachHome);
    const inviteCode = await ownedInviteCode();
    await publishInviteCodeReceipt(inviteCode);
    await signOutForNextActor();
    await publishStage('coach-signed-out');

    await signIn(studentEmail, studentPassword, profile.studentHome);
    await publishStage('student-signed-in');
    const studentFrame = await publishSourceFrame('student-home', profile.studentHome);
    await element(by.id(profile.studentEntry)).tap();
    await waitForId(profile.professionals);
    await waitForId(profile.scan);
    await element(by.id(profile.scan)).tap();
    await publishStage('camera-requested');
    // UiAutomator dismisses the Android-owned permission controller outside
    // Detox's app lifecycle. Give Android a bounded chance to dismiss the
    // system dialog. The native bridge owns the ordered app resume only after
    // it has captured the real PermissionController frame.
    await new Promise((resolve) => setTimeout(resolve, 1_250));

    // The instrumentation owner observes and semantically denies the real
    // permission-controller prompt. The app must then expose its manual-entry
    // surface without a coordinate or synthetic permission shortcut.
    await waitForId(profile.error);
    await expect(
      element(
        by.text(
          'Camera access is required to scan a QR code. Grant permission in your device settings, or type the code manually.',
        ),
      ),
    ).toBeVisible();
    await expect(element(by.id(profile.qrModal))).not.toBeVisible();
    await waitForId(profile.codeInput);
    await publishStage('manual-entry-ready');
    const promptFrame = await publishSourceFrame('manual-entry', profile.codeInput);

    await element(by.id(profile.codeInput)).replaceText(inviteCode);
    await waitForId(profile.connect);
    await publishSubmitIntent({
      manualCodeSha256: sha256(inviteCode),
      actionSha256: sha256('detox-camera-manual-submit-v1'),
    });
    await publishStage('submit-intent-published');
    // The owner arms request-body capture after reading the intent; tapping
    // before its acknowledgement races the capture and loses the receipt.
    await waitForSubmitCaptureReady();
    await element(by.id(profile.connect)).tap();
    await publishStage('connection-submitted');
    await waitForId(profile.professionals);
    const connectionId = await pendingConnectionId();
    await waitForId(`${profile.pendingPrefix}${connectionId}`);
    await expect(element(by.id(profile.error))).not.toBeVisible();
    await publishStage('pending-observed');
    const pendingFrame = await publishSourceFrame(
      'pending-connection',
      `${profile.pendingPrefix}${connectionId}`,
    );

    // The instrumentation bridge captures the real system-denial aftermath on
    // a separate UiAutomator thread. Keep Detox alive briefly after the final
    // product assertion so that bridge work can publish its run-private
    // receipt before Detox begins asynchronous native teardown.
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    const commandHash = process.env.DETOX_ANDROID_CAMERA_COMMAND_HASH;
    if (!commandHash || !/^[a-f0-9]{64}$/u.test(commandHash))
      throw new Error('Owned Detox camera command hash is missing');
    const childPid = process.pid;
    const command = (commandId) => ({
      commandId,
      pid: childPid,
      argvSha256: commandHash,
    });
    await publishFlowReceipt({
      schemaVersion: 1,
      kind: 'private-owned-android-detox-camera-flow',
      status: 'observed',
      captureRunId: process.env.DETOX_ANDROID_CAMERA_CAPTURE_RUN_ID,
      ownerRunId: process.env.DETOX_ANDROID_CAMERA_OWNER_RUN_ID,
      attemptId: process.env.DETOX_ANDROID_CAMERA_ATTEMPT_ID,
      serial: process.env.DETOX_ANDROID_CAMERA_SERIAL,
      appId,
      actorRoles: ['coach', 'student'],
      inviteCodeSha256: sha256(inviteCode),
      pendingConnectionId: connectionId,
      pendingConnectionIdSha256: sha256(connectionId),
      source: 'owned-detox-child-native-hierarchy',
      childPid,
      commandHash,
      originalActionReceipts: [
        {
          kind: 'sign-in',
          actor: 'coach',
          selector: profile.signInSubmit,
          action: 'tap',
          command: command(1),
          frame: coachFrame,
        },
        {
          kind: 'sign-in',
          actor: 'student',
          selector: profile.signInSubmit,
          action: 'tap',
          command: command(2),
          frame: studentFrame,
        },
        {
          kind: 'camera-denial',
          selector: profile.scan,
          action: 'tap',
          command: command(3),
          frame: promptFrame,
        },
        {
          kind: 'manual-submit',
          selector: profile.connect,
          action: 'tap',
          command: command(4),
          frame: pendingFrame,
        },
      ],
    });
  });
});

async function publishInviteCodeReceipt(value) {
  const p = await protocol();
  await p.writeAtomicTrainingJson(artifactRoot, 'detox-training-camera-invite-code.private.json', {
    schemaVersion: 1,
    kind: 'private-owned-android-detox-camera-invite-code',
    captureRunId: process.env.DETOX_ANDROID_CAMERA_CAPTURE_RUN_ID,
    ownerRunId: process.env.DETOX_ANDROID_CAMERA_OWNER_RUN_ID,
    sessionRunId: process.env.DETOX_ANDROID_CAMERA_BACKEND_RUN_ID,
    actor: 'coach',
    value,
    sha256: sha256(value),
  });
}

async function waitForSubmitCaptureReady() {
  const readyPath = path.join(artifactRoot, 'detox-training-camera-submit-ready.private.json');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(readyPath, 'utf8'));
      if (
        value?.schemaVersion === 1 &&
        value.kind === 'private-owned-android-detox-camera-submit-ready' &&
        value.captureRunId === process.env.DETOX_ANDROID_CAMERA_CAPTURE_RUN_ID &&
        value.ownerRunId === process.env.DETOX_ANDROID_CAMERA_OWNER_RUN_ID &&
        value.sessionRunId === process.env.DETOX_ANDROID_CAMERA_BACKEND_RUN_ID
      )
        return;
      throw new Error('Android camera submit readiness acknowledgement is invalid');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('Android camera submit readiness acknowledgement timed out');
}

async function publishSubmitIntent({ manualCodeSha256, actionSha256 }) {
  const p = await protocol();
  const value = {
    schemaVersion: 1,
    kind: 'private-owned-detox-camera-submit-intent',
    captureRunId: process.env.DETOX_ANDROID_CAMERA_CAPTURE_RUN_ID,
    ownerRunId: process.env.DETOX_ANDROID_CAMERA_OWNER_RUN_ID,
    sessionRunId: process.env.DETOX_ANDROID_CAMERA_BACKEND_RUN_ID,
    actor: 'student',
    manualCodeSha256,
    actionSha256,
  };
  await p.writeAtomicTrainingJson(
    artifactRoot,
    'detox-training-camera-submit-intent.private.json',
    value,
  );
}
