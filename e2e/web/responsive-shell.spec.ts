import { expect, test, type Page } from '@playwright/test';

async function renderedContrastRatio(
  page: Page,
  foregroundTestId: string,
  backgroundTestId: string,
): Promise<number> {
  return page.evaluate(
    ({ foregroundTestId, backgroundTestId }) => {
      const foreground = document.querySelector(`[data-testid="${foregroundTestId}"]`);
      const background = document.querySelector(`[data-testid="${backgroundTestId}"]`);
      if (!foreground || !background) throw new Error('Unable to resolve contrast test elements');

      const luminance = (value: string) => {
        const channels = value
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
        if (!channels || channels.length !== 3)
          throw new Error(`Unsupported rendered color: ${value}`);
        const [red, green, blue] = channels.map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };

      const foregroundLuminance = luminance(getComputedStyle(foreground).color);
      const backgroundLuminance = luminance(getComputedStyle(background).backgroundColor);
      const lighter = Math.max(foregroundLuminance, backgroundLuminance);
      const darker = Math.min(foregroundLuminance, backgroundLuminance);
      return (lighter + 0.05) / (darker + 0.05);
    },
    { foregroundTestId, backgroundTestId },
  );
}

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1000 },
  { name: 'desktop', width: 1440, height: 1000 },
];

test.describe('@smoke @critical @feature:shell @feature:auth @feature:student @feature:professional @feature:connections @feature:nutrition @feature:training responsive shell', () => {
  for (const viewport of viewports) {
    test(`${viewport.name} shell has no horizontal overflow and supports role onboarding`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/auth/role-selection');
      await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      const [studentRoleBox, professionalRoleBox, continueBox] = await Promise.all([
        page.getByTestId('auth.roleSelection.studentCard').boundingBox(),
        page.getByTestId('auth.roleSelection.professionalCard').boundingBox(),
        page.getByTestId('auth.roleSelection.continueButton').boundingBox(),
      ]);
      expect(studentRoleBox).not.toBeNull();
      expect(professionalRoleBox).not.toBeNull();
      expect(continueBox).not.toBeNull();
      if (studentRoleBox && professionalRoleBox && continueBox) {
        if (viewport.width >= 1024) {
          expect(Math.abs(studentRoleBox.y - professionalRoleBox.y)).toBeLessThanOrEqual(1);
          expect(professionalRoleBox.x).toBeGreaterThan(studentRoleBox.x + studentRoleBox.width);
          expect(studentRoleBox.width).toBeLessThanOrEqual(520);
          expect(continueBox.width).toBeLessThanOrEqual(420);
        } else {
          expect(professionalRoleBox.y).toBeGreaterThan(studentRoleBox.y + studentRoleBox.height);
          if (viewport.width >= 768) {
            expect(studentRoleBox.width).toBeLessThanOrEqual(672);
            expect(continueBox.width).toBeLessThanOrEqual(672);
          }
        }
      }

      await page.getByTestId('auth.roleSelection.studentCard').click();
      await page.getByTestId('auth.roleSelection.continueButton').click();
      await expect(page.getByTestId('student.home.dashboardTitle').last()).toHaveText('Your day');
      await expect(page.getByTestId('student.home.accountButton').last()).toBeVisible();
      await expect(page.getByTestId('student.home.accountButton').last()).toContainText(
        'My coaches',
      );
      const trainingCard = page.getByTestId(/student\.home\.training\.(goCta|emptyCta)/).last();
      const nutritionCard = page.getByTestId(/student\.home\.nutrition\.(goCta|emptyCta)/).last();
      const [trainingCardBox, nutritionCardBox] = await Promise.all([
        trainingCard.boundingBox(),
        nutritionCard.boundingBox(),
      ]);
      expect(trainingCardBox).not.toBeNull();
      expect(nutritionCardBox).not.toBeNull();
      if (trainingCardBox && nutritionCardBox) {
        if (viewport.width >= 768) {
          expect(Math.abs(trainingCardBox.y - nutritionCardBox.y)).toBeLessThanOrEqual(1);
          expect(nutritionCardBox.x).toBeGreaterThanOrEqual(
            trainingCardBox.x + trainingCardBox.width,
          );
          expect(Math.abs(trainingCardBox.width - nutritionCardBox.width)).toBeLessThanOrEqual(1);
        } else {
          expect(nutritionCardBox.y).toBeGreaterThan(trainingCardBox.y + trainingCardBox.height);
        }
      }
      const homeTab = page.getByTestId('tabs.home').last();
      await expect(homeTab).toBeVisible();
      const tabBox = await homeTab.boundingBox();
      expect(tabBox).not.toBeNull();
      if (!tabBox) return;
      if (viewport.width < 768) {
        expect(tabBox.y).toBeGreaterThan(viewport.height - 140);

        const [trainingStat, nutritionStat, hydrationStat] = await Promise.all([
          page.getByTestId('student.home.trainingStat').last().boundingBox(),
          page.getByTestId('student.home.nutritionStat').last().boundingBox(),
          page.getByTestId('student.home.hydrationCard').last().boundingBox(),
        ]);
        expect(trainingStat).not.toBeNull();
        expect(nutritionStat).not.toBeNull();
        expect(hydrationStat).not.toBeNull();
        if (trainingStat && nutritionStat && hydrationStat) {
          expect(Math.abs(trainingStat.y - nutritionStat.y)).toBeLessThanOrEqual(1);
          expect(hydrationStat.y).toBeGreaterThan(trainingStat.y + trainingStat.height);
        }
      } else {
        expect(tabBox.x).toBeLessThanOrEqual(12);
        if (viewport.width >= 1024) {
          expect(tabBox.width).toBeGreaterThan(160);
        } else {
          expect(tabBox.width).toBeGreaterThan(60);
          expect(tabBox.width).toBeLessThan(120);
        }
      }
    });
  }

  for (const viewport of viewports) {
    test(`${viewport.name} professional dashboard prioritizes actionable work`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/auth/role-selection');
      await page.getByTestId('auth.roleSelection.professionalCard').click();
      await page.getByTestId('auth.roleSelection.continueButton').click();
      await page.getByTestId('pro.specialty.cta_skip').click();

      const dashboard = page.getByTestId('pro.home.screen').last();
      await expect(dashboard).toBeVisible();
      await expect(dashboard.getByText('Needs attention', { exact: true })).toBeVisible();
      await expect(dashboard.getByTestId('pro.home.planChangeNotification')).toBeVisible();
      await expect(dashboard.getByTestId('pro.home.rosterCta')).toBeVisible();
      await expect(dashboard.getByTestId('pro.home.nutritionCta')).toHaveCount(0);
      await expect(dashboard.getByTestId('pro.home.trainingCta')).toBeVisible();
      await expect(dashboard.getByTestId('pro.home.activeStudents')).toContainText('2');
      await expect(dashboard.getByTestId('pro.home.inviteSpecialtyRequired')).toBeVisible();
      await expect(dashboard.getByTestId('pro.home.inviteSpecialtyCta')).toBeVisible();
      await expect(dashboard.getByTestId('pro.home.subscriptionCta')).toContainText(
        '2 / 10 active students',
      );
      expect(
        await dashboard
          .getByTestId('pro.home.subscriptionCta')
          .evaluate((card) =>
            [card, ...Array.from(card.querySelectorAll('*'))].every(
              (element) => getComputedStyle(element).backgroundImage === 'none',
            ),
          ),
      ).toBe(true);

      const [primaryBox, inviteBox] = await Promise.all([
        dashboard.getByTestId('pro.home.primaryColumn').boundingBox(),
        dashboard.getByTestId('pro.home.secondaryColumn').boundingBox(),
      ]);
      expect(primaryBox).not.toBeNull();
      expect(inviteBox).not.toBeNull();
      if (primaryBox && inviteBox) {
        if (viewport.width >= 1024) {
          expect(inviteBox.x).toBeGreaterThanOrEqual(primaryBox.x + primaryBox.width);
        } else {
          expect(inviteBox.y).toBeGreaterThanOrEqual(primaryBox.y + primaryBox.height);
        }
      }

      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1);
    });
  }

  test('student route families expose real overflow instead of clipping it', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();

    for (const tab of ['tabs.home', 'tabs.nutrition', 'tabs.training', 'tabs.account']) {
      await page.getByTestId(tab).last().click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1);
    }
  });

  test('manual invite controls reflow inside a narrow phone viewport', async ({ page }) => {
    const viewport = { width: 320, height: 720 };
    await page.setViewportSize(viewport);
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    const professionalsButton = page.getByTestId('student.home.accountButton').last();
    const professionalsBox = await professionalsButton.boundingBox();
    expect(professionalsBox).not.toBeNull();
    if (professionalsBox) {
      expect(professionalsBox.x).toBeGreaterThanOrEqual(0);
      expect(professionalsBox.x + professionalsBox.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    await professionalsButton.click();

    const input = page.getByTestId('student.professionals.codeInput');
    await input.fill('MC-123456');
    const connectButton = page.getByTestId('student.professionals.connectButton');
    await expect(connectButton).toBeVisible();

    const [inputBox, buttonBox] = await Promise.all([
      input.boundingBox(),
      connectButton.boundingBox(),
    ]);
    expect(inputBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    if (!inputBox || !buttonBox) return;

    for (const box of [inputBox, buttonBox]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    expect(buttonBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height);
    expect(Math.abs(buttonBox.width - inputBox.width)).toBeLessThanOrEqual(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1);
  });

  test('student hydration log intake stays inside the card at 320px (ET-108)', async ({ page }) => {
    const viewport = { width: 320, height: 720 };
    await page.setViewportSize(viewport);
    await page.goto('/auth/role-selection');
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await page.goto('/nutrition');

    const waterWidget = page.getByTestId('student.nutrition.waterWidget').last();
    await waterWidget.scrollIntoViewIfNeeded();
    const input = page.getByTestId('student.nutrition.waterWidget.intakeInput').last();
    const logButton = page.getByTestId('student.nutrition.waterWidget.logButton').last();

    const [cardBox, inputBox, buttonBox] = await Promise.all([
      waterWidget.boundingBox(),
      input.boundingBox(),
      logButton.boundingBox(),
    ]);
    expect(cardBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    if (!cardBox || !inputBox || !buttonBox) return;

    // Both controls stay fully inside the card and the viewport instead of
    // being clipped by an inputRow that never shrinks below its intrinsic
    // content width (the CSS flexbox min-width:auto trap on web).
    for (const box of [inputBox, buttonBox]) {
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1);

    await expect(logButton).toHaveAccessibleName('Log Intake');
    await input.click();
    await page.keyboard.press('Tab');
    await expect(logButton).toBeFocused();
  });
});

test.describe('@accessibility @critical @feature:shell keyboard and dialog behavior', () => {
  test('primary actions expose explicit readable enabled and disabled states', async ({ page }) => {
    await page.goto('/auth/role-selection');
    const continueButton = page.getByTestId('auth.roleSelection.continueButton');
    const continueLabel = page.getByTestId('auth.roleSelection.continueButton.label');

    await expect(continueButton).toBeDisabled();
    await expect(continueButton).toHaveAttribute('aria-disabled', 'true');
    await expect(continueButton).toHaveCSS('opacity', '1');
    expect(
      await renderedContrastRatio(
        page,
        'auth.roleSelection.continueButton.label',
        'auth.roleSelection.continueButton',
      ),
    ).toBeGreaterThanOrEqual(4.5);

    await page.getByTestId('auth.roleSelection.studentCard').click();
    await expect(continueButton).toBeEnabled();
    await expect(continueLabel).toBeVisible();
    expect(
      await renderedContrastRatio(
        page,
        'auth.roleSelection.continueButton.label',
        'auth.roleSelection.continueButton',
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test('keyboard focus is visible and follows role option order', async ({ page }) => {
    await page.goto('/auth/role-selection');
    const studentOption = page.getByTestId('auth.roleSelection.studentCard');
    const professionalOption = page.getByTestId('auth.roleSelection.professionalCard');
    await studentOption.focus();
    await page.keyboard.press('Tab');
    await expect(professionalOption).toBeFocused();
    const outlineStyle = await professionalOption.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    );
    expect(outlineStyle).not.toBe('none');
  });

  const supportDialogViewports = [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'compact', width: 320, height: 720 },
  ];

  for (const viewport of supportDialogViewports) {
    test(`support dialog at ${viewport.name} (${viewport.width}x${viewport.height}) contains focus, closes on Escape, and restores the trigger`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/auth/role-selection');
      await page.getByTestId('auth.roleSelection.studentCard').click();
      await page.getByTestId('auth.roleSelection.continueButton').click();
      await page.getByTestId('tabs.account').last().click();

      const trigger = page.getByTestId('settings.account.supportQuickCta');
      await trigger.focus();
      await trigger.click();
      const modal = page.getByTestId('settings.account.support.modal');
      const close = page.getByTestId('settings.account.support.closeButton');
      const dialog = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      // The named dialog role/aria-modal live on React Native's own <Modal> ancestor, not on
      // the inner testID node — asserting a single dialog role here also guards against the
      // hook stamping a second, nested, unnamed role="dialog" on `modal`.
      await expect(dialog).toHaveCount(1);
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(dialog).toHaveAccessibleName('Talk to support');
      await expect(close).toHaveAccessibleName('Close support dialog');
      await expect(modal.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1);
      await expect(close).toBeFocused();

      await page.keyboard.press('Shift+Tab');
      const lastFocusable = modal
        .locator(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="button"]:not([aria-disabled="true"])',
        )
        .last();
      await expect(lastFocusable).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible();
      await expect(trigger).toBeFocused();
    });
  }
});
