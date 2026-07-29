async function scrollAccountRowIntoView(testId) {
  await waitFor(element(by.id(testId)))
    .toBeVisible()
    .whileElement(by.id('settings.account.screen'))
    .scroll(260, 'down', 0.5, 0.35);
}

async function scrollToLegalRows() {
  await scrollAccountRowIntoView('settings.account.privacyPolicyRow');
  await scrollAccountRowIntoView('settings.account.termsRow');
}

async function scrollToSupportQuickAction() {
  await waitFor(element(by.id('settings.account.supportQuickCta')))
    .toBeVisible()
    .whileElement(by.id('settings.account.screen'))
    .scroll(300, 'up', 0.5, 0.5);
}

async function scrollToSignOutConfirmation() {
  await waitFor(element(by.id('settings.account.signOutConfirmCta')))
    .toBeVisible()
    .whileElement(by.id('settings.account.screen'))
    .scroll(240, 'down', 0.5, 0.5);
}

async function scrollToDeleteCta() {
  await scrollAccountRowIntoView('settings.account.deleteCta');
}

async function scrollToAccountFooter() {
  await scrollAccountRowIntoView('settings.account.version');
}

module.exports = {
  scrollAccountRowIntoView,
  scrollToAccountFooter,
  scrollToDeleteCta,
  scrollToLegalRows,
  scrollToSignOutConfirmation,
  scrollToSupportQuickAction,
};
