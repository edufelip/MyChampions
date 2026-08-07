async function scrollToInviteCodeControls() {
  await waitFor(element(by.id('pro.home.rotateCodeCta')))
    .toBeVisible()
    .whileElement(by.id('pro.home.screen'))
    .scroll(300, 'down', 0.5, 0.5);
  await waitFor(element(by.id('pro.home.inviteCodeValue'))).toBeVisible().withTimeout(10000);
  await expect(element(by.id('pro.home.shareCodeCta'))).toBeVisible();
}

module.exports = {
  scrollToInviteCodeControls,
};
