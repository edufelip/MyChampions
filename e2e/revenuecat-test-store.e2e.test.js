/* global beforeAll, by, describe, device, element, expect, it, waitFor */

const isLiveRevenueCatRun =
  process.env.E2E_AUTH_SESSION === 'true' && process.env.REVENUECAT_LIVE_E2E === 'true';
const describeLiveRevenueCat = isLiveRevenueCatRun ? describe : describe.skip;
const liveScenario = process.env.REVENUECAT_LIVE_SCENARIO?.trim() || 'all';
const itWithExpirationMonitor =
  process.env.REVENUECAT_LIVE_MONITOR_EXPIRATION === 'true' &&
  (liveScenario === 'all' || liveScenario === 'professional-regression')
    ? it
    : it.skip;

const PRIMARY_EMAIL = 'e2e-auth-session@example.test';
const PRIMARY_PASSWORD = 'E2E-password-123!';
const CREATED_EMAIL = 'e2e-created-account@example.test';
const CREATED_PASSWORD = 'E2E-create-123!';

const PROFESSIONAL_PAYWALL = {
  title:
    /^(Grow your professional practice|Expanda sua atuação profissional|Haz crecer tu práctica profesional)$/,
  value:
    /^(Manage more than 10 active students and unlock AI meal-photo analysis\.|Gerencie mais de 10 alunos ativos e desbloqueie a análise de refeições por foto com IA\.|Gestiona más de 10 alumnos activos y desbloquea el análisis de comidas por foto con IA\.)$/,
  benefits: [],
  monthly: /^(Monthly|Mensal|Mensual),.*(month|mês|mes)$/i,
  annual: /^(Annual|Anual),.*(year|ano|año)$/i,
  purchase:
    /^(Continue with selected plan|Continuar com o plano selecionado|Continuar con el plan seleccionado)$/,
  storeNote:
    /^(Subscription is managed through your device app store\.|A assinatura é gerenciada pela loja de aplicativos do seu dispositivo\.|La suscripción se gestiona mediante la tienda de aplicaciones de tu dispositivo\.)$/,
  renewal:
    /^(Subscription auto-renews until cancelled\.|A assinatura é renovada automaticamente até ser cancelada\.|La suscripción se renueva automáticamente hasta que se cancele\.)$/,
  restore: /^(Restore purchases|Restaurar compra)$/,
  // The already-published professional paywall predates the visible close-label
  // remediation in this controlled student batch. Its close control is still
  // exercised by the separately pinned coordinate below.
  close: null,
  terms: /^(Terms of Use|Termos de Uso|Términos de uso)$/,
  privacy: /^(Privacy Policy|Política de Privacidade|Política de privacidad)$/,
  // Retained from the green Professional Paywall v1 iPhone 17 live run.
  closeCoordinate: { x: 45, y: 110 },
  annualCoordinate: { x: 201, y: 575 },
  purchaseCoordinate: { x: 201, y: 735 },
  expectedEntitlement: 'professional_pro',
};

const STUDENT_PAYWALL = {
  title:
    /^(Unlock AI meal analysis|Desbloqueie a análise de refeições com IA|Desbloquea el análisis de comidas con IA)$/,
  value:
    /^(Analyze meal photos with AI\. Student tracking remains available without a subscription\.|Analise fotos de refeições com IA\. O acompanhamento do aluno continua disponível sem assinatura\.|Analiza fotos de comidas con IA\. El seguimiento del alumno sigue disponible sin suscripción\.)$/,
  benefits: [
    /^(Estimate calories and macros from a meal photo|Estime calorias e macronutrientes a partir de uma foto da refeição|Estima calorías y macronutrientes a partir de una foto de la comida)$/,
    /^(Review and edit every estimate before saving|Revise e edite cada estimativa antes de salvar|Revisa y edita cada estimación antes de guardar)$/,
    /^(Keep standard meal tracking available for free|Continue usando o acompanhamento padrão de refeições gratuitamente|Sigue usando gratis el seguimiento estándar de comidas)$/,
  ],
  monthly: /^(Monthly|Mensal|Mensual),.*(month|mês|mes)$/i,
  annual: /^(Annual|Anual),.*(year|ano|año)$/i,
  purchase:
    /^(Continue with selected plan|Continuar com o plano selecionado|Continuar con el plan seleccionado)$/,
  storeNote:
    /^(Subscription is managed through your device app store\.|A assinatura é gerenciada pela loja de aplicativos do seu dispositivo\.|La suscripción se gestiona mediante la tienda de aplicaciones de tu dispositivo\.)$/,
  renewal:
    /^(Subscription auto-renews\. Cancel anytime\.|A assinatura é renovada automaticamente\. Cancele quando quiser\.|La suscripción se renueva automáticamente\. Cancela cuando quieras\.)$/,
  restore: /^(Restore purchases|Restaurar compra)$/,
  close: /^(Close|Fechar|Cerrar)$/,
  terms: /^(Terms of Service|Termos de Uso|Términos de servicio)$/,
  privacy: /^(Privacy Policy|Política de Privacidade|Política de Privacidad)$/,
  // Derived from the approved iPhone 17 provider preview; the live matrix is
  // the calibration gate before this coordinate contract can be accepted.
  closeCoordinate: { x: 45, y: 110 },
  annualCoordinate: { x: 201, y: 575 },
  purchaseCoordinate: { x: 201, y: 700 },
  expectedEntitlement: 'student_pro',
};

function itForScenario(scenario, name, testFunction) {
  const scenarioTest = liveScenario === 'all' || liveScenario === scenario ? it : it.skip;
  return scenarioTest(name, testFunction);
}

async function waitForFirstVisible(matchers, timeout = 15000) {
  let lastError;

  for (const matcher of matchers) {
    try {
      const target = element(matcher);
      await waitFor(target).toBeVisible().withTimeout(timeout);
      return target;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function dismissPasswordSavePromptIfPresent() {
  // This system-owned sheet is visible in XCUITest screenshots but its buttons
  // are absent from Detox's React Native matcher tree. On the pinned iPhone 17
  // simulator the "Not Now" button center is stable. When the sheet is absent,
  // this lands on a role card; the intended card is selected immediately after.
  await device.tap({ x: 120, y: 535 });
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function selectProfessionalRole() {
  await waitFor(element(by.id('auth.roleSelection.title')))
    .toBeVisible()
    .withTimeout(15000);
  await device.enableSynchronization();
  try {
    await dismissPasswordSavePromptIfPresent();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await expect(element(by.id('auth.roleSelection.professionalTapTarget'))).toExist();
    // Detox's 100% visibility gate rejects the Fabric frame because iOS reports
    // its 44pt height as 44.00003pt. Tap the visible card center directly.
    await device.tap({ x: 201, y: 545 });
    await device.tap({ x: 370, y: 820 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await element(by.id('auth.roleSelection.continueButton')).tap();
    await waitFor(element(by.id('pro.specialty.screen')))
      .toBeVisible()
      .withTimeout(10000);
  } finally {
    await device.disableSynchronization();
  }
}

async function completeProfessionalOnboarding() {
  await selectProfessionalRole();
  await waitFor(element(by.id('pro.specialty.cta_skip')))
    .toBeVisible()
    .withTimeout(5000);
  await new Promise((resolve) => setTimeout(resolve, 750));
  await element(by.id('pro.specialty.cta_skip')).tap();
  await waitFor(element(by.id('pro.home.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

async function openProfessionalSubscription() {
  await completeProfessionalOnboarding();
  await waitFor(element(by.id('pro.home.subscriptionCta')))
    .toBeVisible()
    .whileElement(by.id('pro.home.screen'))
    .scroll(300, 'down', 0.5, 0.5);
  await element(by.id('pro.home.subscriptionCta')).tap();
  await waitFor(element(by.id('pro.subscription.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

async function selectStudentRole() {
  await waitFor(element(by.id('auth.roleSelection.title')))
    .toBeVisible()
    .withTimeout(15000);
  await device.enableSynchronization();
  try {
    await dismissPasswordSavePromptIfPresent();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await expect(element(by.id('auth.roleSelection.studentTapTarget'))).toExist();
    await device.tap({ x: 201, y: 395 });
    await device.tap({ x: 370, y: 820 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await element(by.id('auth.roleSelection.continueButton')).tap();
    await waitFor(element(by.id('student.home.screen')))
      .toBeVisible()
      .withTimeout(10000);
  } finally {
    await device.disableSynchronization();
  }
}

async function openAiMealBuilder() {
  await device.openURL({ url: 'mychampions://nutrition/custom-meals/new' });
  await waitFor(element(by.id('meal.builder.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

async function openStudentAiGate() {
  await openAiMealBuilder();
  await waitFor(element(by.id('meal.photoAnalysis.paywall')))
    .toBeVisible()
    .withTimeout(15000);
}

async function waitForCustomPaywall(role) {
  const paywall = role === 'student' ? STUDENT_PAYWALL : PROFESSIONAL_PAYWALL;
  // RevenueCat Paywalls render as native SwiftUI controls. Their visible copy
  // is exposed to XCTest through accessibility labels rather than RN text.
  const headline = await waitForFirstVisible([by.label(paywall.title)]);
  const value = await waitForFirstVisible([by.label(paywall.value)]);
  const monthlyPlan = await waitForFirstVisible([by.label(paywall.monthly)]);
  const annualPlan = await waitForFirstVisible([by.label(paywall.annual)]);
  const purchaseCta = await waitForFirstVisible([by.label(paywall.purchase)]);

  await expect(headline).toBeVisible();
  await expect(value).toBeVisible();
  for (const benefit of paywall.benefits) {
    await waitForFirstVisible([by.label(benefit)]);
  }
  await expect(monthlyPlan).toBeVisible();
  await expect(annualPlan).toBeVisible();
  await expect(purchaseCta).toBeVisible();
  await waitForFirstVisible([by.label(paywall.storeNote)]);
  await waitForFirstVisible([by.label(paywall.renewal)]);
  await waitForFirstVisible([by.label(paywall.restore)]);
  if (paywall.close) {
    await waitForFirstVisible([by.label(paywall.close)]);
  }
  await waitForFirstVisible([by.label(paywall.terms)]);
  await waitForFirstVisible([by.label(paywall.privacy)]);

  return paywall;
}

async function enterTestStorePurchase(paywall, interval = 'monthly') {
  if (interval === 'annual') {
    await device.tap(paywall.annualCoordinate);
  }

  // RevenueCat's SwiftUI hosting view reports activation frames below the
  // visible iPhone 17 viewport. Coordinates are intentionally role-specific
  // and used only after the corresponding accessibility contract is asserted.
  await device.tap(paywall.purchaseCoordinate);
  try {
    await waitFor(element(by.text('Test Store Purchase')))
      .toBeVisible()
      .withTimeout(5000);
  } catch {
    // Some StoreKit/Test Store combinations insert the native confirmation
    // sheet before RevenueCat's Test Store outcome controls.
    await waitForFirstVisible([by.label('Purchase'), by.label('Comprar')]);
    await device.tap({ x: 201, y: 760 });
    await waitFor(element(by.text('Test Store Purchase')))
      .toBeVisible()
      .withTimeout(15000);
  }
  await device.takeScreenshot(
    `revenuecat-${liveScenario}-${paywall.expectedEntitlement}-${interval}-purchase-sheet`,
  );

  return paywall;
}

async function openTestStorePurchase(sourceCtaId, role, interval = 'monthly') {
  await element(by.id(sourceCtaId)).tap();
  const paywall = await waitForCustomPaywall(role);
  return enterTestStorePurchase(paywall, interval);
}

async function dismissPaywall(role, returnScreenId = 'pro.subscription.screen') {
  const paywall = role === 'student' ? STUDENT_PAYWALL : PROFESSIONAL_PAYWALL;
  try {
    await waitForFirstVisible([by.label(paywall.title)], 1500);
    await device.tap(paywall.closeCoordinate);
  } catch {
    // Failed and valid Test Store outcomes may already dismiss the paywall,
    // depending on the RevenueCat SDK version.
  }
  await waitFor(element(by.id(returnScreenId)))
    .toBeVisible()
    .withTimeout(10000);
}

async function signOut() {
  await device.openURL({ url: 'mychampions://settings/account' });
  await waitFor(element(by.id('settings.account.screen')))
    .toBeVisible()
    .withTimeout(10000);
  await waitFor(element(by.id('settings.account.signOutCta')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('settings.account.signOutCta')).tap();
  await waitFor(element(by.id('settings.account.signOutConfirm')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('settings.account.signOutConfirmCta')).tap();
  await waitFor(element(by.id('auth.signIn.title')))
    .toBeVisible()
    .withTimeout(10000);
}

async function signInWithGoogleFixture() {
  await waitFor(element(by.id('auth.signIn.googleButton')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('auth.signIn.googleButton')).tap();
  await waitFor(element(by.id('auth.roleSelection.title')))
    .toBeVisible()
    .withTimeout(10000);
}

async function signInWithPrimaryFixture() {
  await element(by.id('auth.signIn.emailInput')).replaceText(PRIMARY_EMAIL);
  await element(by.id('auth.signIn.passwordInput')).replaceText(PRIMARY_PASSWORD);
  await element(by.id('auth.signIn.submitButton')).tap();
  await waitFor(element(by.id('auth.roleSelection.title')))
    .toBeVisible()
    .withTimeout(10000);
}

async function signInWithCreatedFixture() {
  await element(by.id('auth.signIn.emailInput')).replaceText(CREATED_EMAIL);
  await element(by.id('auth.signIn.passwordInput')).replaceText(CREATED_PASSWORD);
  await element(by.id('auth.signIn.submitButton')).tap();
  await waitFor(element(by.id('auth.roleSelection.title')))
    .toBeVisible()
    .withTimeout(10000);
}

async function createStudentFixtureAccount() {
  await element(by.id('auth.signIn.scrollView')).scrollTo('bottom', NaN, 0.5);
  // Expo's development warning toast overlaps the bottom CTA on the pinned
  // iPhone 17 simulator. Its close control is not exposed separately to XCTest.
  await device.tap({ x: 370, y: 790 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await waitFor(element(by.id('auth.signIn.createAccountButton')))
    .toBeVisible(35)
    .withTimeout(5000);
  await device.tap({ x: 201, y: 790 });
  await waitFor(element(by.id('auth.createAccount.title')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('auth.createAccount.nameInput')).replaceText('RevenueCat Student');
  await element(by.id('auth.createAccount.emailInput')).replaceText(CREATED_EMAIL);
  await element(by.id('auth.createAccount.scrollView')).scrollTo('bottom', NaN, 0.2);
  await waitFor(element(by.id('auth.createAccount.passwordInput')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('auth.createAccount.passwordInput')).replaceText(CREATED_PASSWORD);
  // Activating the keyboard changes the compact iPhone viewport after the
  // initial scroll, so re-anchor the form before locating confirmation.
  await element(by.id('auth.createAccount.scrollView')).scrollTo('bottom', NaN, 0.8);
  await waitFor(element(by.id('auth.createAccount.passwordConfirmationInput')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('auth.createAccount.passwordConfirmationInput')).replaceText(
    CREATED_PASSWORD,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await element(by.id('auth.createAccount.scrollView')).scrollTo('bottom', NaN, 0.8);
  await waitFor(element(by.id('auth.createAccount.submitButton')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('auth.createAccount.submitButton')).tap();
  await waitFor(element(by.id('auth.roleSelection.title')))
    .toBeVisible()
    .withTimeout(10000);
}

async function expectProfessionalStatus(label, timeout = 15000) {
  await waitFor(element(by.id('pro.subscription.statusValue')))
    .toHaveLabel(`Subscription: ${label}`)
    .withTimeout(timeout);
}

async function expectStudentAiLocked(timeout = 15000) {
  await waitFor(element(by.id('meal.photoAnalysis.paywall')))
    .toBeVisible()
    .withTimeout(timeout);
  await expect(element(by.id('meal.photoAnalysis.paywall.cta'))).toBeVisible();
  await expect(element(by.id('meal.photoAnalysis.cta'))).not.toBeVisible();
}

async function expectStudentAiActive(timeout = 30000) {
  await waitFor(element(by.id('meal.photoAnalysis.cta')))
    .toBeVisible()
    .withTimeout(timeout);
  await expect(element(by.id('meal.photoAnalysis.paywall'))).not.toBeVisible();
}

async function launchFreshPrimaryProfessional() {
  await device.launchApp({ newInstance: true, delete: true });
  await device.disableSynchronization();
  await openProfessionalSubscription();
}

async function launchFreshPrimaryStudent() {
  await device.launchApp({ newInstance: true, delete: true });
  await device.disableSynchronization();
  await selectStudentRole();
  await openStudentAiGate();
}

async function launchFreshPrimaryProfessionalAiGate() {
  await device.launchApp({ newInstance: true, delete: true });
  await device.disableSynchronization();
  await completeProfessionalOnboarding();
  await openStudentAiGate();
}

async function openProfessionalSubscriptionFromCurrentSession() {
  await device.openURL({ url: 'mychampions://professional/subscription' });
  await waitFor(element(by.id('pro.subscription.screen')))
    .toBeVisible()
    .withTimeout(10000);
}

describeLiveRevenueCat('RevenueCat Test Store live subscription lifecycle', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
  });

  itForScenario(
    'professional-regression',
    'propagates Professional Paywall v1 and keeps a dismissed purchase inactive',
    async () => {
      await launchFreshPrimaryProfessional();
      await expectProfessionalStatus('Inactive');

      await element(by.id('pro.subscription.purchaseCta')).tap();
      await waitForCustomPaywall('professional');
      await device.takeScreenshot('revenuecat-live-professional-paywall-v1');
      await dismissPaywall('professional');

      await expectProfessionalStatus('Inactive');
      await device.takeScreenshot('revenuecat-live-professional-paywall-v1-dismissed');
    },
  );

  itForScenario(
    'professional-regression',
    'keeps a cancelled professional purchase inactive',
    async () => {
      await launchFreshPrimaryProfessional();
      await expectProfessionalStatus('Inactive');

      await openTestStorePurchase('pro.subscription.purchaseCta', 'professional');
      await element(by.text('Cancel')).tap();
      await dismissPaywall('professional');

      await expectProfessionalStatus('Inactive');
      await device.takeScreenshot('revenuecat-live-professional-cancelled');
    },
  );

  itForScenario(
    'professional-regression',
    'keeps a failed professional purchase inactive without granting access',
    async () => {
      await launchFreshPrimaryProfessional();
      await expectProfessionalStatus('Inactive');

      await openTestStorePurchase('pro.subscription.purchaseCta', 'professional');
      await element(by.text('Test failed purchase')).tap();
      const failedPurchaseAlertCta = await waitForFirstVisible([by.label('OK'), by.text('OK')]);
      await failedPurchaseAlertCta.tap();
      await dismissPaywall('professional');

      await expectProfessionalStatus('Inactive');
      await element(by.id('pro.subscription.refreshCta')).tap();
      await expectProfessionalStatus('Inactive');
      await device.takeScreenshot('revenuecat-live-professional-failed');
    },
  );

  itForScenario(
    'professional-regression',
    'grants only the professional privilege after a valid professional purchase',
    async () => {
      await launchFreshPrimaryProfessional();
      await expectProfessionalStatus('Inactive');

      await openTestStorePurchase('pro.subscription.purchaseCta', 'professional');
      await element(by.text('Test valid purchase')).tap();
      await dismissPaywall('professional');

      await expectProfessionalStatus('Active', 30000);
      await expect(element(by.id('pro.subscription.warning'))).not.toBeVisible();
      await device.takeScreenshot('revenuecat-live-professional-active');
    },
  );

  itForScenario(
    'professional-regression',
    'keeps Test Store customer state across reinstall and a non-destructive restore call',
    async () => {
      await launchFreshPrimaryProfessional();
      await expectProfessionalStatus('Active', 20000);

      await element(by.id('pro.subscription.restoreCta')).tap();
      await expectProfessionalStatus('Active', 20000);
      await device.takeScreenshot('revenuecat-live-professional-restored');
    },
  );

  itForScenario(
    'professional-regression',
    'does not leak professional privileges across account switches',
    async () => {
      await launchFreshPrimaryProfessional();
      await expectProfessionalStatus('Active', 20000);
      await signOut();

      await signInWithGoogleFixture();
      await openProfessionalSubscription();
      await expectProfessionalStatus('Inactive', 20000);
      await device.takeScreenshot('revenuecat-live-google-inactive');
      await signOut();

      await signInWithPrimaryFixture();
      await openProfessionalSubscription();
      await expectProfessionalStatus('Active', 20000);
      await device.takeScreenshot('revenuecat-live-primary-returned-active');
    },
  );

  itForScenario(
    'professional-regression',
    'does not let the student privilege unlock professional capabilities',
    async () => {
      await launchFreshPrimaryProfessional();
      await expectProfessionalStatus('Active', 20000);
      await signOut();

      await createStudentFixtureAccount();
      await selectStudentRole();
      await openStudentAiGate();
      await expectStudentAiLocked();

      await openTestStorePurchase('meal.photoAnalysis.paywall.cta', 'student');
      await element(by.text('Test valid purchase')).tap();
      await expectStudentAiActive(20000);
      await device.takeScreenshot('revenuecat-live-student-active');

      await signOut();
      await signInWithCreatedFixture();
      await openProfessionalSubscription();
      await expectProfessionalStatus('Inactive', 20000);
      await device.takeScreenshot('revenuecat-live-student-professional-inactive');
    },
  );

  itForScenario(
    'student-dismiss',
    'shows Student Paywall v1 and dismissal grants no entitlement',
    async () => {
      await launchFreshPrimaryStudent();
      await expectStudentAiLocked();

      await element(by.id('meal.photoAnalysis.paywall.cta')).tap();
      await waitForCustomPaywall('student');
      await device.takeScreenshot('revenuecat-student-v1-paywall');
      await dismissPaywall('student', 'meal.builder.screen');

      await expectStudentAiLocked();
      await device.takeScreenshot('revenuecat-student-v1-dismissed-locked');
    },
  );

  itForScenario(
    'student-cancel',
    'keeps student AI locked after Test Store cancellation',
    async () => {
      await launchFreshPrimaryStudent();
      await expectStudentAiLocked();

      await openTestStorePurchase('meal.photoAnalysis.paywall.cta', 'student');
      await element(by.text('Cancel')).tap();
      await dismissPaywall('student', 'meal.builder.screen');

      await expectStudentAiLocked();
      await device.takeScreenshot('revenuecat-student-v1-cancelled-locked');
    },
  );

  itForScenario('student-fail', 'keeps student AI locked after Test Store failure', async () => {
    await launchFreshPrimaryStudent();
    await expectStudentAiLocked();

    await openTestStorePurchase('meal.photoAnalysis.paywall.cta', 'student');
    await element(by.text('Test failed purchase')).tap();
    const failedPurchaseAlertCta = await waitForFirstVisible([by.label('OK'), by.text('OK')]);
    await failedPurchaseAlertCta.tap();
    await dismissPaywall('student', 'meal.builder.screen');

    await expectStudentAiLocked();
    await device.takeScreenshot('revenuecat-student-v1-failed-locked');
  });

  itForScenario(
    'student-duplicate',
    'coalesces duplicate student purchase taps without granting access',
    async () => {
      await launchFreshPrimaryStudent();
      await expectStudentAiLocked();

      await element(by.id('meal.photoAnalysis.paywall.cta')).tap();
      const paywall = await waitForCustomPaywall('student');
      await device.tap(paywall.purchaseCoordinate);
      await device.tap(paywall.purchaseCoordinate);
      try {
        await waitFor(element(by.text('Test Store Purchase')))
          .toBeVisible()
          .withTimeout(5000);
      } catch {
        await waitForFirstVisible([by.label('Purchase'), by.label('Comprar')]);
        await device.tap({ x: 201, y: 760 });
        await waitFor(element(by.text('Test Store Purchase')))
          .toBeVisible()
          .withTimeout(15000);
      }
      await device.takeScreenshot('revenuecat-student-v1-duplicate-purchase-sheet');
      await element(by.text('Cancel')).tap();
      await dismissPaywall('student', 'meal.builder.screen');

      await expectStudentAiLocked();
      await device.takeScreenshot('revenuecat-student-v1-duplicate-tap-locked');
    },
  );

  itForScenario(
    'student-monthly',
    `activates only ${STUDENT_PAYWALL.expectedEntitlement} after a monthly student purchase`,
    async () => {
      await launchFreshPrimaryStudent();
      await expectStudentAiLocked();

      await openTestStorePurchase('meal.photoAnalysis.paywall.cta', 'student', 'monthly');
      await element(by.text('Test valid purchase')).tap();
      await expectStudentAiActive();
      await device.takeScreenshot('revenuecat-student-v1-monthly-active');

      await signOut();
      await signInWithPrimaryFixture();
      await openProfessionalSubscription();
      await expectProfessionalStatus('Inactive', 20000);
      await device.takeScreenshot('revenuecat-student-v1-monthly-professional-inactive');
    },
  );

  itForScenario(
    'student-annual',
    `activates only ${STUDENT_PAYWALL.expectedEntitlement} after an annual student purchase`,
    async () => {
      await launchFreshPrimaryStudent();
      await expectStudentAiLocked();

      await openTestStorePurchase('meal.photoAnalysis.paywall.cta', 'student', 'annual');
      await element(by.text('Test valid purchase')).tap();
      await expectStudentAiActive();
      await device.takeScreenshot('revenuecat-student-v1-annual-active');

      await signOut();
      await signInWithPrimaryFixture();
      await openProfessionalSubscription();
      await expectProfessionalStatus('Inactive', 20000);
      await device.takeScreenshot('revenuecat-student-v1-annual-professional-inactive');
    },
  );

  itForScenario(
    'student-restore',
    'restores student AI after reinstall without granting professional access',
    async () => {
      await launchFreshPrimaryStudent();
      await expectStudentAiLocked();
      await openTestStorePurchase('meal.photoAnalysis.paywall.cta', 'student');
      await element(by.text('Test valid purchase')).tap();
      await expectStudentAiActive();

      await device.launchApp({ newInstance: true, delete: true });
      await device.disableSynchronization();
      await openProfessionalSubscription();
      await expectProfessionalStatus('Inactive', 20000);
      await element(by.id('pro.subscription.restoreCta')).tap();
      await expectProfessionalStatus('Inactive', 20000);
      await device.takeScreenshot('revenuecat-student-v1-restore-professional-inactive');

      await signOut();
      await signInWithPrimaryFixture();
      await selectStudentRole();
      await openAiMealBuilder();
      await expectStudentAiActive();
      await device.takeScreenshot('revenuecat-student-v1-restored-active');
    },
  );

  itForScenario(
    'student-switch',
    'does not leak student AI access across account switches',
    async () => {
      await launchFreshPrimaryStudent();
      await expectStudentAiLocked();
      await openTestStorePurchase('meal.photoAnalysis.paywall.cta', 'student');
      await element(by.text('Test valid purchase')).tap();
      await expectStudentAiActive();
      await signOut();

      await signInWithGoogleFixture();
      await selectStudentRole();
      await openStudentAiGate();
      await expectStudentAiLocked(20000);
      await device.takeScreenshot('revenuecat-student-v1-alternate-account-locked');
      await signOut();

      await signInWithPrimaryFixture();
      await selectStudentRole();
      await openAiMealBuilder();
      await expectStudentAiActive();
      await device.takeScreenshot('revenuecat-student-v1-primary-account-active');
    },
  );

  itForScenario(
    'professional-route',
    `routes a professional AI gate to ${PROFESSIONAL_PAYWALL.expectedEntitlement}`,
    async () => {
      await launchFreshPrimaryProfessionalAiGate();
      await expectStudentAiLocked();

      await element(by.id('meal.photoAnalysis.paywall.cta')).tap();
      const paywall = await waitForCustomPaywall('professional');
      await device.takeScreenshot('revenuecat-professional-route-paywall-v1');
      await enterTestStorePurchase(paywall);
      await element(by.text('Test valid purchase')).tap();

      await expectStudentAiActive();
      await openProfessionalSubscriptionFromCurrentSession();
      await expectProfessionalStatus('Active', 20000);
      await device.takeScreenshot('revenuecat-professional-route-active');
    },
  );

  itWithExpirationMonitor(
    'observes Test Store renewal and expiration instead of trusting a cached privilege',
    async () => {
      await launchFreshPrimaryProfessional();
      await expectProfessionalStatus('Active', 20000);

      await new Promise((resolve) => setTimeout(resolve, 6 * 60 * 1000));
      await element(by.id('pro.subscription.refreshCta')).tap();
      await expectProfessionalStatus('Active', 20000);
      await device.takeScreenshot('revenuecat-live-professional-renewed');

      const expirationDeadline = Date.now() + 25 * 60 * 1000;
      let expired = false;
      while (Date.now() < expirationDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
        await element(by.id('pro.subscription.refreshCta')).tap();
        try {
          await waitFor(element(by.id('pro.subscription.statusValue')))
            .toHaveLabel('Subscription: Inactive')
            .withTimeout(10000);
          expired = true;
          break;
        } catch {
          await expectProfessionalStatus('Active', 10000);
        }
      }

      if (!expired) {
        throw new Error(
          'Test Store monthly entitlement did not expire within the expected window.',
        );
      }
      await device.takeScreenshot('revenuecat-live-professional-expired');
    },
  );
});
