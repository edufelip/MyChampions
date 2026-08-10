const describeWithE2EAuthSession =
  process.env.E2E_AUTH_SESSION === 'true' ? describe : describe.skip;
const qrInviteScenario = process.env.E2E_QR_INVITE_SCENARIO;

if (
  process.env.E2E_AUTH_SESSION === 'true' &&
  qrInviteScenario !== undefined &&
  !['valid_payload', 'invalid_payload'].includes(qrInviteScenario)
) {
  throw new Error(
    'Student professionals requires E2E_QR_INVITE_SCENARIO=valid_payload or invalid_payload when a scenario is provided',
  );
}

const itWithValidQrScenario = qrInviteScenario === 'valid_payload' ? it : it.skip;
const itWithInvalidQrScenario = qrInviteScenario === 'invalid_payload' ? it : it.skip;

async function selectStudentRole() {
  await waitFor(element(by.id('auth.roleSelection.title')))
    .toBeVisible()
    .withTimeout(15000);
  await element(by.id('auth.roleSelection.studentCard')).tap();
  await element(by.id('auth.roleSelection.continueButton')).tap();
  await waitFor(element(by.id('student.home.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

async function openProfessionalsScreen() {
  await waitFor(element(by.id('student.home.accountButton')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('student.home.accountButton')).tap();
  await waitFor(element(by.id('student.professionals.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

describeWithE2EAuthSession('Student Professionals Invite Code', () => {
  beforeEach(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: { camera: 'YES' },
      launchArgs: { detoxEnableSynchronization: 0 },
    });
  });

  it('shows manual invite-code controls and blocks empty submission', async () => {
    await selectStudentRole();
    await openProfessionalsScreen();

    await expect(element(by.id('student.professionals.codeInput'))).toBeVisible();
    await expect(element(by.id('student.professionals.connectButton.disabled'))).toBeVisible();
    await expect(element(by.id('student.professionals.scanQrButton'))).toBeVisible();
  });

  it('creates a pending connection after manual invite-code submission', async () => {
    await selectStudentRole();
    await openProfessionalsScreen();

    await element(by.id('student.professionals.codeInput')).replaceText('NUT123');
    await waitFor(element(by.id('student.professionals.connectButton')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('student.professionals.codeInput')).tapReturnKey();

    await waitFor(
      element(by.id('student.professionals.connectionPending.e2e-pending-nutritionist-connection')),
    )
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.id('student.professionals.submitError'))).not.toBeVisible();
  });

  it('handles QR scanner entry after camera permission is granted', async () => {
    await selectStudentRole();
    await openProfessionalsScreen();

    await element(by.id('student.professionals.scanQrButton')).tap();

    try {
      await waitFor(element(by.id('student.professionals.qrCloseButton')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('student.professionals.qrCloseButton')).tap();
    } catch {
      try {
        await waitFor(
          element(
            by.id('student.professionals.connectionPending.e2e-pending-nutritionist-connection'),
          ),
        )
          .toBeVisible()
          .withTimeout(5000);
      } catch {
        await waitFor(element(by.id('student.professionals.submitError')))
          .toBeVisible()
          .withTimeout(5000);
      }
    }

    await waitFor(element(by.id('student.professionals.screen')))
      .toBeVisible()
      .withTimeout(5000);
  });

  itWithValidQrScenario(
    'creates a pending connection from a scanned QR invite payload',
    async () => {
      await selectStudentRole();
      await openProfessionalsScreen();

      await element(by.id('student.professionals.scanQrButton')).tap();

      await waitFor(
        element(
          by.id('student.professionals.connectionPending.e2e-pending-nutritionist-connection'),
        ),
      )
        .toBeVisible()
        .withTimeout(10000);
      await expect(element(by.id('student.professionals.submitError'))).not.toBeVisible();
    },
  );

  itWithInvalidQrScenario(
    'shows an actionable error for an invalid QR invite payload',
    async () => {
      await selectStudentRole();
      await openProfessionalsScreen();

      await element(by.id('student.professionals.scanQrButton')).tap();

      await waitFor(element(by.id('student.professionals.qrScanError')))
        .toBeVisible()
        .withTimeout(10000);
      await expect(
        element(
          by.id('student.professionals.connectionPending.e2e-pending-nutritionist-connection'),
        ),
      ).not.toBeVisible();

      await element(by.id('student.professionals.qrCloseButton')).tap();
      await waitFor(element(by.id('student.professionals.screen')))
        .toBeVisible()
        .withTimeout(5000);
    },
  );

  it('confirms and ends an active professional connection', async () => {
    await selectStudentRole();
    await openProfessionalsScreen();

    await waitFor(element(by.id('student.professionals.connectionCard.0')))
      .toBeVisible()
      .withTimeout(10000);
    await waitFor(element(by.id('student.professionals.unbindButton.0')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('student.professionals.unbindButton.0')).tap();

    await waitFor(element(by.id('student.professionals.unbindConfirm')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('student.professionals.unbindConfirm.cancel')).tap();
    await waitFor(element(by.id('student.professionals.unbindConfirm')))
      .not.toBeVisible()
      .withTimeout(5000);

    await element(by.id('student.professionals.unbindButton.0')).tap();
    await waitFor(element(by.id('student.professionals.unbindConfirm.confirm')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('student.professionals.unbindConfirm.confirm')).tap();

    await waitFor(element(by.id('student.professionals.connectionEnded.0')))
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.id('student.professionals.unbindButton.0'))).not.toBeVisible();
  });
});
