import { expect, test, type Page } from '@playwright/test';

async function chooseProfessional(page: import('@playwright/test').Page) {
  await page.goto('/auth/role-selection');
  await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await expect(page.getByTestId('pro.specialty.screen')).toBeVisible();
  await page.getByTestId('pro.specialty.add.nutritionist').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await page.getByTestId('pro.specialty.add.fitness_coach').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await page.getByTestId('pro.specialty.cta_continue').click();
  await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
}

async function chooseLocale(
  page: import('@playwright/test').Page,
  locale: 'en-US' | 'pt-BR' | 'es-ES',
) {
  if (locale === 'en-US') {
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    return;
  }

  await page.goto('/settings/account');
  await page.getByTestId('settings.account.languageRow').click();
  await page.getByTestId(`settings.languageSelect.option.${locale}`).click();
  await page.getByTestId('settings.languageSelect.saveButton').click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function setBulkDenyMutationMode(
  page: import('@playwright/test').Page,
  mode: 'delay' | 'failure',
) {
  await page.evaluate((mutationMode) => {
    window.localStorage.setItem('mychampions.e2e.pending-mutation', mutationMode);
  }, mode);
}

async function clearBulkDenyMutationMode(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.localStorage.removeItem('mychampions.e2e.pending-mutation');
  });
}

const responsiveViewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1000 },
] as const;

test.describe('@critical @feature:auth @feature:connections @feature:subscription critical product paths', () => {
  for (const viewport of responsiveViewports) {
    test(`${viewport.name} student entry reaches manual connection fallback`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'Responsive critical proof is Chromium-only');
      await page.setViewportSize(viewport);
      await page.goto('/auth/role-selection');

      const continueButton = page.getByTestId('auth.roleSelection.continueButton');
      await expect(continueButton).toBeDisabled();
      await page.getByTestId('auth.roleSelection.studentCard').click();
      await expect(continueButton).toBeEnabled();
      await continueButton.click();
      await expect(page.getByTestId('student.home.ready').last()).toBeVisible();

      await page.getByTestId('student.home.accountButton').last().click();
      await expect(page.getByTestId('student.professionals.screen')).toBeVisible();
      // Not asserting a zero-connection empty state here: this shared dev server also
      // seeds every student with an active nutritionist connection fixture
      // (EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE=assigned, needed by the nutrition
      // tracking suites), so an empty professionals list isn't a reachable state in
      // this environment. This test only proves the manual invite-code fallback works.
      await page.getByTestId('student.professionals.scanQrButton').click();
      await expect(page.getByTestId('student.professionals.submitError')).toBeVisible();
      await expect(page.getByTestId('student.professionals.codeInput')).toBeVisible();

      const inputBox = await page.getByTestId('student.professionals.codeInput').boundingBox();
      expect(inputBox).not.toBeNull();
      if (inputBox) {
        expect(inputBox.x).toBeGreaterThanOrEqual(0);
        expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1);
    });
  }

  test('professional subscription boundary remains fail-closed across browser engines', async ({
    page,
  }) => {
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.professionalCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await page.getByTestId('pro.specialty.cta_skip').click();
    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();

    await page.getByTestId('pro.home.subscriptionCta').last().click();
    await expect(page.getByTestId('pro.subscription.capabilityUnavailable')).toBeVisible();
    await expect(page.getByTestId('pro.subscription.purchaseCta')).toHaveCount(0);
    await expect(page.getByTestId('pro.subscription.restoreCta')).toHaveCount(0);
    await expect(page.getByTestId('pro.subscription.refreshCta')).toBeEnabled();
  });

  test('professional new plan builders expose first child actions on compact mobile viewports', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Compact regression is Chromium-only');
    test.setTimeout(120_000);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 720 },
    ]) {
      const runInFreshMobileContext = async (flow: (page: Page) => Promise<void>) => {
        const context = await browser.newContext({
          viewport,
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        try {
          await flow(page);
        } finally {
          await context.close();
        }
      };

      await runInFreshMobileContext(async (page) => {
        await chooseProfessional(page);
        await page.getByTestId('tabs.nutrition').last().click();
        await page.getByTestId('pro.library.nutrition.create').click();
        await expect(page.getByTestId('pro.nutrition_plan.screen')).toBeVisible();
        const nutritionName = page.getByTestId('pro.plan.metadata.name');
        await nutritionName.fill('Critical Nutrition Plan');
        await nutritionName.press('Tab');
        await page.waitForTimeout(500);
        await expect(page.getByTestId('pro.nutrition_plan.addMeal')).toBeVisible();
      });

      await runInFreshMobileContext(async (page) => {
        await chooseProfessional(page);
        await page.getByTestId('tabs.training').last().click();
        await page.getByTestId('pro.library.training.create').click();
        await expect(page.getByTestId('pro.training_plan.screen')).toBeVisible();
        const trainingName = page.getByTestId('pro.training_plan.name');
        await trainingName.fill('Critical Training Plan');
        await trainingName.press('Tab');
        await page.waitForTimeout(500);
        await expect(page.getByTestId('pro.training_plan.addSession')).toBeVisible();
      });
    }
  });

  const documentedTodayRoutes = [
    { path: '/student/nutrition/today', screenTestId: 'student.nutrition.screen' },
    { path: '/student/training/today', screenTestId: 'student.training.screen' },
  ] as const;

  for (const viewport of responsiveViewports) {
    for (const { path, screenTestId } of documentedTodayRoutes) {
      test(`${viewport.name} documented deep link ${path} reaches the Student tracking screen, not Unmatched Route`, async ({
        page,
      }, testInfo) => {
        test.skip(
          testInfo.project.name !== 'chromium',
          'Responsive critical proof is Chromium-only',
        );
        await page.setViewportSize(viewport);
        await page.goto('/auth/role-selection');
        await page.getByTestId('auth.roleSelection.studentCard').click();
        await page.getByTestId('auth.roleSelection.continueButton').click();
        await expect(page.getByTestId('student.home.ready').last()).toBeVisible();

        // ET-109: documented screen-spec routes (SC-209/SC-210, TC-209/TC-210) must resolve
        // to the same Student tracking surfaces as their canonical /nutrition, /training
        // tab aliases instead of rendering Expo Router's Unmatched Route page.
        await page.goto(path);
        await expect(page.getByTestId('expo-router-unmatched')).toHaveCount(0);
        await expect(page.getByTestId(screenTestId)).toBeVisible();
        expect(page.url()).toContain(path);

        // Reloading the documented route must remain on the same screen.
        await page.reload();
        await expect(page.getByTestId('expo-router-unmatched')).toHaveCount(0);
        await expect(page.getByTestId(screenTestId)).toBeVisible();
        expect(page.url()).toContain(path);
      });
    }
  }

  test('professional session accessing a documented student /today deep link fails closed to the professional shell', async ({
    page,
  }) => {
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.professionalCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await page.getByTestId('pro.specialty.cta_skip').click();
    await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();

    for (const { path } of documentedTodayRoutes) {
      await page.goto(path);
      await expect(page.getByTestId('pro.home.screen').last()).toBeVisible();
      await expect(page.getByTestId('expo-router-unmatched')).toHaveCount(0);
    }
  });
});

const compactMobileViewports = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 720 },
] as const;

test.describe('@critical @feature:connections browser bulk deny confirmation', () => {
  for (const viewport of compactMobileViewports) {
    test(`${viewport.name} pending bulk deny confirms, cancels, and reports the result`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(120_000);
      test.skip(testInfo.project.name !== 'chromium', 'Mobile browser proof is Chromium-only');

      const context = await browser.newContext({
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();

      try {
        await chooseProfessional(page);
        await page.goto('/professional/pending');
        await expect(page.getByTestId('pro.pending.screen')).toBeVisible();
        await expect(page.getByTestId('pro.pending.hero')).toContainText('1 pending');

        // Row selection goes through the dedicated checkbox control, not the row body
        // itself — the row is a non-interactive container (ET-106) so Accept/Deny stay
        // sibling, independently operable controls.
        await page.getByTestId('pro.pending.checkbox.0').click();
        await expect(page.getByTestId('pro.pending.bulkDenyButton')).toBeVisible();
        await page.getByTestId('pro.pending.bulkDenyButton').click();

        const dialog = page.getByTestId('pro.pending.bulkDenyConfirm');
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('role', 'dialog');
        await expect(dialog).toHaveAttribute('aria-modal', 'true');
        await expect(dialog).toHaveAttribute('aria-labelledby', /.+/);
        await expect(dialog).toContainText('1 selected');
        await expect
          .poll(() =>
            page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid),
          )
          .toBe('pro.pending.bulkDenyConfirm.cancel');
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath(`bulk-deny-confirmation-${viewport.name}.png`),
        });

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId('pro.pending.bulkDenyButton')).toBeFocused();
        await expect(page.getByTestId('pro.pending.bulkDenySelectionCount')).toContainText(
          '1 selected',
        );

        await page.getByTestId('pro.pending.bulkDenyButton').click();
        await expect(dialog).toBeVisible();
        await page.getByTestId('pro.pending.bulkDenyConfirm.cancel').click();
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId('pro.pending.bulkDenyButton')).toBeFocused();
        await expect(page.getByTestId('pro.pending.bulkDenySelectionCount')).toContainText(
          '1 selected',
        );

        await page.getByTestId('pro.pending.bulkDenyButton').click();
        await page.getByTestId('pro.pending.bulkDenyConfirm.confirm').click();
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId('pro.pending.bulkDenyResult')).toContainText(
          'Requests denied successfully.',
        );
        await expect(page.getByTestId('pro.pending.bulkDenyResult')).toBeFocused();
        await expect(page.getByTestId('pro.pending.hero')).toContainText('0 pending');
        await expect(page.getByTestId('pro.pending.row.0')).toHaveCount(0);
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath(`bulk-deny-success-${viewport.name}.png`),
        });
      } finally {
        await context.close();
      }
    });
  }
});

const bulkDenyLocaleCases = [
  {
    error: 'Some requests could not be denied. Try again.',
    locale: 'en-US',
    selected: '1 selected',
    success: 'Requests denied successfully.',
  },
  {
    error: 'Não foi possível negar algumas solicitações. Tente novamente.',
    locale: 'pt-BR',
    selected: '1 selecionado(s)',
    success: 'Solicitações negadas com sucesso.',
  },
  {
    error: 'No se pudieron rechazar algunas solicitudes. Inténtalo de nuevo.',
    locale: 'es-ES',
    selected: '1 seleccionado(s)',
    success: 'Solicitudes rechazadas correctamente.',
  },
] as const;

test.describe('@critical @feature:connections browser bulk deny states and locales', () => {
  for (const { error, locale, selected, success } of bulkDenyLocaleCases) {
    test(`${locale} covers loading, success, and recoverable failure`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(120_000);
      test.skip(testInfo.project.name !== 'chromium', 'Mobile browser proof is Chromium-only');

      const context = await browser.newContext({
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();

      try {
        await chooseProfessional(page);
        await chooseLocale(page, locale);
        await page.goto('/professional/pending');
        await expect(page.getByTestId('pro.pending.hero')).toContainText(
          locale === 'en-US' ? '1 pending' : locale === 'pt-BR' ? '1 pendente' : '1 pendiente',
        );
        await page.getByTestId('pro.pending.checkbox.0').click();
        await page.getByTestId('pro.pending.bulkDenyButton').click();

        const dialog = page.getByTestId('pro.pending.bulkDenyConfirm');
        const confirmButton = page.getByTestId('pro.pending.bulkDenyConfirm.confirm');
        await expect(dialog).toBeVisible();

        await setBulkDenyMutationMode(page, 'failure');
        await confirmButton.click();
        await expect(page.getByTestId('pro.pending.bulkDenyConfirm.error')).toContainText(error);
        await expect(page.getByTestId('pro.pending.bulkDenySelectionCount')).toContainText(
          selected,
        );
        await clearBulkDenyMutationMode(page);

        await setBulkDenyMutationMode(page, 'delay');
        await confirmButton.click();
        await expect(confirmButton).toBeDisabled();
        await expect(page.getByTestId('pro.pending.bulkDenyResult')).toContainText(success);
        await expect(page.getByTestId('pro.pending.hero')).toContainText(
          locale === 'en-US' ? '0 pending' : locale === 'pt-BR' ? '0 pendentes' : '0 pendientes',
        );
        await expect(page.getByTestId('pro.pending.row.0')).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
});

test('@critical @feature:connections keeps dialog recovery available after going offline', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== 'chromium', 'Mobile browser proof is Chromium-only');

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  try {
    await chooseProfessional(page);
    await page.goto('/professional/pending');
    await page.getByTestId('pro.pending.checkbox.0').click();
    await page.getByTestId('pro.pending.bulkDenyButton').click();

    await page.evaluate(() => {
      sessionStorage.setItem('mychampions.e2e.network-status', 'offline');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'mychampions.e2e.network-status',
          newValue: 'offline',
        }),
      );
    });
    await page.getByTestId('pro.pending.searchInput').fill('offline', { force: true });

    const dialog = page.getByTestId('pro.pending.bulkDenyConfirm');
    await expect(page.getByTestId('pro.pending.offlineBanner')).toBeVisible();
    await expect(dialog.getByTestId('pro.pending.bulkDenyConfirm.confirm')).toBeDisabled();
    await expect(dialog.getByTestId('pro.pending.bulkDenyConfirm.cancel')).toBeEnabled();
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('bulk-deny-offline-recovery-mobile-390.png'),
    });

    await dialog.getByTestId('pro.pending.bulkDenyConfirm.cancel').click();
    await expect(dialog).toBeHidden();
  } finally {
    await context.close();
  }
});
