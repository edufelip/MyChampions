async function tapCredentialSkip() {
  await waitFor(element(by.id('pro.specialty.credential.skip')))
    .toBeVisible()
    .whileElement(by.id('pro.specialty.screen'))
    .scroll(260, 'down', 0.5, 0.35);
  await element(by.id('pro.specialty.credential.skip')).tap();
}

module.exports = {
  tapCredentialSkip,
};
