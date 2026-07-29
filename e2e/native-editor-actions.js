const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function submitFocusedEditor(testId) {
  await waitFor(element(by.id(testId))).toBeFocused().withTimeout(2000);
  if (device.getPlatform() === 'android') {
    await device.getUiDevice().pressEnter();
  } else {
    await element(by.id(testId)).tapReturnKey();
  }
}

async function dismissFocusedEditor(testId) {
  await waitFor(element(by.id(testId))).toBeFocused().withTimeout(2000);
  if (device.getPlatform() === 'android') {
    await device.pressBack();
  } else {
    await element(by.id(testId)).tapReturnKey();
  }
}

async function waitForElementEnabled(testId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastAttributes;

  do {
    lastAttributes = await element(by.id(testId)).getAttributes();
    const candidates = Array.isArray(lastAttributes.elements)
      ? lastAttributes.elements
      : [lastAttributes];
    if (candidates.some((attributes) => attributes.enabled)) {
      return;
    }
    await sleep(100);
  } while (Date.now() < deadline);

  throw new Error(
    `Timed out waiting for ${testId} to become enabled: ${JSON.stringify(lastAttributes)}`
  );
}

module.exports = {
  dismissFocusedEditor,
  submitFocusedEditor,
  waitForElementEnabled,
};
