import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildIosConnectionPasswordOfferActions,
  nativeConnectionPasswordOfferDismissSelector,
  nativeConnectionPasswordOfferCommandMetadataPath,
  nativeConnectionPasswordOfferMaxCommandMetadataBytes,
  nativeConnectionPasswordOfferMaxScreenshotBytes,
  nativeConnectionPasswordOfferPromptSelector,
  nativeConnectionPasswordOfferPromptScreenshotPath,
  requireNativeConnectionPasswordOfferCommandSequence,
  requireNativeConnectionPasswordOfferWitness,
  requireNativeConnectionPasswordOfferWitnesses,
} from '../../scripts/testing/native-connection-password-offer-witness';

const homeSelector = 'pro.home.screen';

// Sanitized from the retained v8 Maestro command metadata. The Command-suffixed
// key and explicit command-level optional=false are part of the observed shape.
function retainedAnimationCommand(sequenceNumber = 4) {
  const animation = {
    optional: false,
    timeout: '5000',
  };
  return {
    command: { waitForAnimationToEndCommand: animation },
    metadata: {
      duration: 1222,
      evaluatedCommand: { waitForAnimationToEndCommand: { ...animation } },
      sequenceNumber,
      status: 'COMPLETED',
      timestamp: 1790855747373,
    },
  };
}

function command(command: Record<string, unknown>, sequenceNumber: number) {
  return {
    command,
    metadata: {
      status: 'COMPLETED',
      duration: 1,
      sequenceNumber,
      timestamp: 1790855747000 + sequenceNumber,
      evaluatedCommand: command,
    },
  };
}

function validCommands(
  selectedHomeSelector = homeSelector,
  promptScreenshotPath = nativeConnectionPasswordOfferPromptScreenshotPath('coach-home'),
) {
  return [
    command({ applyConfigurationCommand: { optional: false } }, 0),
    command(
      {
        assertConditionCommand: {
          optional: false,
          timeout: '30000',
          condition: {
            visible: { optional: false, textRegex: nativeConnectionPasswordOfferPromptSelector },
          },
        },
      },
      1,
    ),
    command({ takeScreenshotCommand: { optional: false, path: promptScreenshotPath } }, 2),
    command(
      {
        assertConditionCommand: {
          optional: false,
          timeout: '30000',
          condition: {
            visible: {
              optional: false,
              textRegex: nativeConnectionPasswordOfferDismissSelector,
              enabled: true,
            },
          },
        },
      },
      3,
    ),
    retainedAnimationCommand(),
    command(
      {
        tapOnElement: {
          optional: false,
          longPress: false,
          selector: {
            textRegex: nativeConnectionPasswordOfferDismissSelector,
            enabled: true,
            optional: false,
          },
          retryIfNoChange: true,
          waitToSettleTimeoutMs: 5000,
          waitUntilVisible: false,
        },
      },
      5,
    ),
    command(
      {
        assertConditionCommand: {
          optional: false,
          timeout: '30000',
          condition: {
            notVisible: { optional: false, textRegex: nativeConnectionPasswordOfferPromptSelector },
          },
        },
      },
      6,
    ),
    command(
      {
        assertConditionCommand: {
          optional: false,
          timeout: '90000',
          condition: { visible: { optional: false, idRegex: selectedHomeSelector } },
        },
      },
      7,
    ),
  ];
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function privateFixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'connection-password-offer-')));
  await chmod(root, 0o700);
  const commandMetadataPath = nativeConnectionPasswordOfferCommandMetadataPath('coach-home');
  const promptScreenshotPath = nativeConnectionPasswordOfferPromptScreenshotPath('coach-home');
  const commandBytes = Buffer.from(
    JSON.stringify(validCommands(homeSelector, promptScreenshotPath)),
  );
  const screenshotBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await writeFile(path.join(root, commandMetadataPath), commandBytes, {
    mode: 0o600,
  });
  await writeFile(path.join(root, promptScreenshotPath), screenshotBytes, { mode: 0o600 });
  const witness = {
    kind: 'private-native-connection-password-offer-witness',
    schemaVersion: 1,
    actor: 'coach',
    flowLabel: 'coach-home',
    actorAuthUid: 'coach-fixture-uid',
    signInRequestOrdinal: 1,
    authRequestId: 7,
    commandMetadataPath,
    commandMetadataSha256: digest(commandBytes),
    commandMetadataBytes: commandBytes.length,
    promptScreenshotPath,
    promptScreenshotSha256: digest(screenshotBytes),
    promptScreenshotBytes: screenshotBytes.length,
    promptSelector: nativeConnectionPasswordOfferPromptSelector,
    dismissSelector: nativeConnectionPasswordOfferDismissSelector,
    dismissEnabled: true,
    retryTapIfNoChange: true,
    promptAbsenceAsserted: true,
    steps: [
      'prompt-visible',
      'prompt-screenshot',
      'dismiss-visible-enabled',
      'dismiss-animation-settled',
      'dismiss-tap',
      'prompt-absent',
      'home-visible',
    ],
    nativePassingCases: 0,
  } as const;
  return { root, commandBytes, screenshotBytes, witness };
}

void test('same-flow builder keeps prompt screenshot, animation settling, dismissal, absence, and home order', () => {
  const actions = buildIosConnectionPasswordOfferActions(
    '- tapOn:\n    id: auth.signIn.submitButton',
    'connection-initial-password-offer-prompt',
    homeSelector,
  );
  assert.match(actions, /text: "\^Save Password\\\\\?\$"/);
  assert.match(actions, /takeScreenshot: "connection-initial-password-offer-prompt"/);
  assert.match(actions, /text: "\^Not Now\$"\n    enabled: true/);
  assert.match(actions, /- waitForAnimationToEnd:\n    timeout: "5000"/);
  assert.match(actions, /retryTapIfNoChange: true/);
  assert.ok(actions.indexOf('takeScreenshot') < actions.indexOf('waitForAnimationToEnd'));
  assert.ok(actions.indexOf('waitForAnimationToEnd') < actions.indexOf('retryTapIfNoChange'));
  assert.ok(actions.indexOf('retryTapIfNoChange') < actions.indexOf('notVisible'));
  assert.ok(actions.indexOf('notVisible') < actions.lastIndexOf('visible'));
  assert.throws(
    () => buildIosConnectionPasswordOfferActions('takeScreenshot: leaked', 'x', homeSelector),
    /credentialActions/,
  );
});

void test('command metadata requires the exact completed seven-step witness', () => {
  assert.deepEqual(
    requireNativeConnectionPasswordOfferCommandSequence(validCommands(), { homeSelector }),
    [
      'prompt-visible',
      'prompt-screenshot',
      'dismiss-visible-enabled',
      'dismiss-animation-settled',
      'dismiss-tap',
      'prompt-absent',
      'home-visible',
    ],
  );
  const legacyAnimationKey = validCommands();
  const animationCommand = legacyAnimationKey[4].command as Record<string, unknown>;
  animationCommand.waitForAnimationToEnd = animationCommand.waitForAnimationToEndCommand;
  delete animationCommand.waitForAnimationToEndCommand;
  const evaluatedAnimationCommand = legacyAnimationKey[4].metadata.evaluatedCommand as Record<
    string,
    unknown
  >;
  evaluatedAnimationCommand.waitForAnimationToEnd =
    evaluatedAnimationCommand.waitForAnimationToEndCommand;
  delete evaluatedAnimationCommand.waitForAnimationToEndCommand;
  assert.throws(
    () => requireNativeConnectionPasswordOfferCommandSequence(legacyAnimationKey, { homeSelector }),
    /evidence steps|sequence/,
  );
  assert.throws(
    () =>
      requireNativeConnectionPasswordOfferCommandSequence(validCommands(), {
        homeSelector,
        promptScreenshotName: 'different-prompt',
      }),
    /not bound/,
  );
  const reordered = validCommands();
  reordered[4].metadata.sequenceNumber = 5;
  reordered[5].metadata.sequenceNumber = 4;
  assert.throws(
    () => requireNativeConnectionPasswordOfferCommandSequence(reordered, { homeSelector }),
    /sequence/,
  );
  const disabled = validCommands();
  const disabledCommand = disabled[3].command as Record<string, unknown>;
  const visible = disabledCommand.assertConditionCommand as {
    condition: { visible: Record<string, unknown> };
  };
  visible.condition.visible.enabled = false;
  assert.throws(
    () => requireNativeConnectionPasswordOfferCommandSequence(disabled, { homeSelector }),
    /evidence steps|sequence/,
  );
  const optional = validCommands();
  (optional[1].metadata as Record<string, unknown>).optional = true;
  assert.throws(
    () => requireNativeConnectionPasswordOfferCommandSequence(optional, { homeSelector }),
    /optional/,
  );
  const optionalSelector = validCommands();
  const optionalSelectorCommand = optionalSelector[3].command as Record<string, unknown>;
  const selector = optionalSelectorCommand.assertConditionCommand as {
    condition: { visible: Record<string, unknown> };
  };
  selector.condition.visible.optional = true;
  assert.throws(
    () => requireNativeConnectionPasswordOfferCommandSequence(optionalSelector, { homeSelector }),
    /optional/,
  );
  const unbounded = validCommands();
  const unboundedCommand = unbounded[4].command as Record<string, unknown>;
  const animation = unboundedCommand.waitForAnimationToEndCommand as { timeout: string };
  animation.timeout = '3000';
  const unboundedEvaluated = unbounded[4].metadata.evaluatedCommand as Record<string, unknown>;
  (unboundedEvaluated.waitForAnimationToEndCommand as { timeout: string }).timeout = '3000';
  assert.throws(
    () => requireNativeConnectionPasswordOfferCommandSequence(unbounded, { homeSelector }),
    /5000/,
  );
});

void test('witness validation binds private files, actor/request identity, and no hierarchy fabrication', async () => {
  const fixture = await privateFixture();
  try {
    const accepted = await requireNativeConnectionPasswordOfferWitness(fixture.witness, {
      artifactRoot: fixture.root,
      actor: 'coach',
      flowLabel: 'coach-home',
      actorAuthUid: 'coach-fixture-uid',
      signInRequestOrdinal: 1,
      authRequestId: 7,
      homeSelector,
    });
    assert.equal(accepted.nativePassingCases, 0);
    const forged = { ...fixture.witness, hierarchyPath: 'password-save-hierarchy.json' };
    await assert.rejects(
      requireNativeConnectionPasswordOfferWitness(forged, {
        artifactRoot: fixture.root,
        homeSelector,
      }),
      /hierarchy path/,
    );
    const rawCredential = { ...fixture.witness, password: 'private-only-test-value' };
    await assert.rejects(
      requireNativeConnectionPasswordOfferWitness(rawCredential, {
        artifactRoot: fixture.root,
        homeSelector,
      }),
      /unknown.*password/,
    );
    const wrongActor = { ...fixture.witness, actor: 'student' as const };
    await assert.rejects(
      requireNativeConnectionPasswordOfferWitness(wrongActor, {
        artifactRoot: fixture.root,
        actor: 'coach',
        homeSelector,
      }),
      /actor differs/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

void test('four connection sign-in witnesses are ordered and complete', async () => {
  const fixture = await privateFixture();
  try {
    const createWitness = async (input: {
      actor: 'coach' | 'student';
      flowLabel: string;
      homeSelector: string;
      signInRequestOrdinal: number;
      authRequestId: number;
    }) => {
      const commandMetadataPath = nativeConnectionPasswordOfferCommandMetadataPath(input.flowLabel);
      const promptScreenshotPath = nativeConnectionPasswordOfferPromptScreenshotPath(
        input.flowLabel,
      );
      const commandBytes = Buffer.from(
        JSON.stringify(validCommands(input.homeSelector, promptScreenshotPath)),
      );
      const screenshotBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await writeFile(path.join(fixture.root, commandMetadataPath), commandBytes, {
        mode: 0o600,
      });
      await writeFile(path.join(fixture.root, promptScreenshotPath), screenshotBytes, {
        mode: 0o600,
      });
      return {
        ...fixture.witness,
        actor: input.actor,
        flowLabel: input.flowLabel,
        actorAuthUid: input.actor === 'coach' ? 'coach-fixture-uid' : 'student-fixture-uid',
        signInRequestOrdinal: input.signInRequestOrdinal,
        authRequestId: input.authRequestId,
        commandMetadataPath,
        commandMetadataSha256: digest(commandBytes),
        commandMetadataBytes: commandBytes.length,
        promptScreenshotPath,
        promptScreenshotSha256: digest(screenshotBytes),
        promptScreenshotBytes: screenshotBytes.length,
      } as const;
    };
    const initialStudent = await createWitness({
      actor: 'student',
      flowLabel: 'connection-switch-1-student-home',
      homeSelector: 'student.home.screen',
      signInRequestOrdinal: 2,
      authRequestId: 8,
    });
    const coachSwitch = await createWitness({
      actor: 'coach',
      flowLabel: 'connection-switch-2-coach-home',
      homeSelector,
      signInRequestOrdinal: 3,
      authRequestId: 9,
    });
    const studentSwitch = await createWitness({
      actor: 'student',
      flowLabel: 'connection-switch-3-student-home',
      homeSelector: 'student.home.screen',
      signInRequestOrdinal: 4,
      authRequestId: 10,
    });
    const rows = await requireNativeConnectionPasswordOfferWitnesses(
      [fixture.witness, initialStudent, coachSwitch, studentSwitch],
      {
        artifactRoot: fixture.root,
        expected: [
          {
            actor: 'coach',
            flowLabel: 'coach-home',
            actorAuthUid: 'coach-fixture-uid',
            signInRequestOrdinal: 1,
            authRequestId: 7,
            homeSelector,
          },
          {
            actor: 'student',
            flowLabel: 'connection-switch-1-student-home',
            actorAuthUid: 'student-fixture-uid',
            signInRequestOrdinal: 2,
            authRequestId: 8,
            homeSelector: 'student.home.screen',
          },
          {
            actor: 'coach',
            flowLabel: 'connection-switch-2-coach-home',
            actorAuthUid: 'coach-fixture-uid',
            signInRequestOrdinal: 3,
            authRequestId: 9,
            homeSelector,
          },
          {
            actor: 'student',
            flowLabel: 'connection-switch-3-student-home',
            actorAuthUid: 'student-fixture-uid',
            signInRequestOrdinal: 4,
            authRequestId: 10,
            homeSelector: 'student.home.screen',
          },
        ],
      },
    );
    assert.deepEqual(
      rows.map((row) => row.actor),
      ['coach', 'student', 'coach', 'student'],
    );
    await assert.rejects(
      requireNativeConnectionPasswordOfferWitnesses(
        [fixture.witness, initialStudent, coachSwitch],
        {
          artifactRoot: fixture.root,
          expected: [
            {
              actor: 'coach',
              flowLabel: 'coach-home',
              actorAuthUid: 'coach-fixture-uid',
              signInRequestOrdinal: 1,
              authRequestId: 7,
              homeSelector,
            },
            {
              actor: 'student',
              flowLabel: 'connection-switch-1-student-home',
              actorAuthUid: 'student-fixture-uid',
              signInRequestOrdinal: 2,
              authRequestId: 8,
              homeSelector: 'student.home.screen',
            },
            {
              actor: 'coach',
              flowLabel: 'connection-switch-2-coach-home',
              actorAuthUid: 'coach-fixture-uid',
              signInRequestOrdinal: 3,
              authRequestId: 9,
              homeSelector,
            },
            {
              actor: 'student',
              flowLabel: 'connection-switch-3-student-home',
              actorAuthUid: 'student-fixture-uid',
              signInRequestOrdinal: 4,
              authRequestId: 10,
              homeSelector: 'student.home.screen',
            },
          ],
        },
      ),
      /count/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

void test('witness files reject parent escapes, oversize metadata, non-PNG bytes, and cross-flow reuse', async () => {
  const fixture = await privateFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'connection-password-offer-outside-'));
  try {
    await chmod(outside, 0o700);
    const linkedParent = path.join(fixture.root, 'linked-artifacts');
    await symlink(outside, linkedParent);
    await writeFile(path.join(outside, fixture.witness.commandMetadataPath), fixture.commandBytes, {
      mode: 0o600,
    });
    const escaped = {
      ...fixture.witness,
      commandMetadataPath: `linked-artifacts/${fixture.witness.commandMetadataPath}`,
    };
    await assert.rejects(
      requireNativeConnectionPasswordOfferWitness(escaped, {
        artifactRoot: fixture.root,
        homeSelector,
      }),
      /parent|canonical/,
    );

    const oversizedCommand = Buffer.alloc(
      nativeConnectionPasswordOfferMaxCommandMetadataBytes + 1,
      0x20,
    );
    await writeFile(
      path.join(fixture.root, fixture.witness.commandMetadataPath),
      oversizedCommand,
      {
        mode: 0o600,
      },
    );
    await assert.rejects(
      requireNativeConnectionPasswordOfferWitness(
        {
          ...fixture.witness,
          commandMetadataSha256: digest(oversizedCommand),
          commandMetadataBytes: oversizedCommand.length,
        },
        { artifactRoot: fixture.root, homeSelector },
      ),
      /bounded size/,
    );

    const invalidPng = Buffer.from('not-a-png');
    await writeFile(path.join(fixture.root, fixture.witness.promptScreenshotPath), invalidPng, {
      mode: 0o600,
    });
    await writeFile(
      path.join(fixture.root, fixture.witness.commandMetadataPath),
      fixture.commandBytes,
      {
        mode: 0o600,
      },
    );
    await assert.rejects(
      requireNativeConnectionPasswordOfferWitness(
        {
          ...fixture.witness,
          promptScreenshotSha256: digest(invalidPng),
          promptScreenshotBytes: invalidPng.length,
        },
        { artifactRoot: fixture.root, homeSelector },
      ),
      /PNG signature/,
    );

    const oversizedScreenshot = Buffer.alloc(
      nativeConnectionPasswordOfferMaxScreenshotBytes + 1,
      0x89,
    );
    await writeFile(
      path.join(fixture.root, fixture.witness.promptScreenshotPath),
      oversizedScreenshot,
      { mode: 0o600 },
    );
    await assert.rejects(
      requireNativeConnectionPasswordOfferWitness(
        {
          ...fixture.witness,
          promptScreenshotSha256: digest(oversizedScreenshot),
          promptScreenshotBytes: oversizedScreenshot.length,
        },
        { artifactRoot: fixture.root, homeSelector },
      ),
      /bounded size/,
    );

    await assert.rejects(
      requireNativeConnectionPasswordOfferWitness(
        { ...fixture.witness, flowLabel: 'connection-switch-1-student-home' },
        { artifactRoot: fixture.root, homeSelector },
      ),
      /flow label/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
