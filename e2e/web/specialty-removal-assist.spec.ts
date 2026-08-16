import { devices, expect, test } from '@playwright/test';

type Locale = 'en-US' | 'pt-BR' | 'es-ES';

test.use({ ...devices['Pixel 5'] });

const localeCopy: Record<Locale, { active: string; pending: string }> = {
  'en-US': {
    active: 'This specialty has 2 active students.',
    pending: 'This specialty has 1 pending student.',
  },
  'pt-BR': {
    active: 'Esta especialidade tem 2 alunos ativos.',
    pending: 'Esta especialidade tem 1 aluno pendente.',
  },
  'es-ES': {
    active: 'Esta especialidad tiene 2 alumnos activos.',
    pending: 'Esta especialidad tiene 1 alumno pendiente.',
  },
};

async function chooseProfessionalWithSpecialties(
  page: import('@playwright/test').Page,
  locale: Locale,
) {
  await page.goto('/auth/role-selection');
  await page.getByTestId('auth.roleSelection.professionalCard').click();
  await page.getByTestId('auth.roleSelection.continueButton').click();
  await chooseLocale(page, locale);
  await page.goto('/professional/specialty');
  await expect(page.getByTestId('pro.specialty.empty')).toBeVisible();
  await page.getByTestId('pro.specialty.add.nutritionist').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await expect(page.getByTestId('pro.specialty.row.nutritionist')).toBeVisible();
  await page.getByTestId('pro.specialty.add.fitness_coach').click();
  await page.getByTestId('pro.specialty.credential.skip').click();
  await expect(page.getByTestId('pro.specialty.row.fitness_coach')).toBeVisible();
}

async function chooseLocale(page: import('@playwright/test').Page, locale: Locale) {
  if (locale === 'en-US') return;

  await page.goto('/settings/account');
  await page.getByTestId('settings.account.languageRow').click();
  await page.getByTestId(`settings.languageSelect.option.${locale}`).click();
  await page.getByTestId('settings.languageSelect.saveButton').click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

test.describe('@critical @feature:professional-specialty-removal-assist specialty removal assist copy', () => {
  for (const locale of ['en-US', 'pt-BR', 'es-ES'] as const) {
    test(`${locale} renders active and pending blocker counts without interpolation tokens`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'Mobile browser proof is Chromium-only');
      await chooseProfessionalWithSpecialties(page, locale);
      await page.getByTestId('pro.specialty.remove.nutritionist').click();
      const assistCard = page.getByTestId('pro.specialty.removalAssist');
      await expect(assistCard).toContainText(localeCopy[locale].active);
      await expect(assistCard).not.toContainText(/[{}]/);
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`specialty-removal-active-${locale}-390.png`),
      });

      await page.getByTestId('pro.specialty.removalAssist.dismiss').click();
      await page.getByTestId('pro.specialty.remove.fitness_coach').click();
      await expect(assistCard).toContainText(localeCopy[locale].pending);
      await expect(assistCard).not.toContainText(/[{}]/);
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`specialty-removal-pending-${locale}-390.png`),
      });
    });
  }
});
