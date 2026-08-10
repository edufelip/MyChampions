const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function attributeCandidates(attributes) {
  return Array.isArray(attributes?.elements) ? attributes.elements : [attributes];
}

function isElementNotFoundError(error) {
  if (
    (typeof error !== 'object' && typeof error !== 'function') ||
    error === null ||
    typeof error.message !== 'string'
  ) {
    return false;
  }

  return (
    error.message.includes('No elements found for') ||
    error.message.includes('NoMatchingViewException: No views in hierarchy found matching:') ||
    error.message.includes('No views in hierarchy found matching:')
  );
}

async function waitForElementAttributes(testId, predicate, timeoutMs, expectation) {
  const deadline = Date.now() + timeoutMs;
  let lastAttributes;
  let lastError;

  do {
    try {
      lastAttributes = await element(by.id(testId)).getAttributes();
      lastError = undefined;
      if (attributeCandidates(lastAttributes).some(predicate)) {
        return lastAttributes;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  } while (Date.now() < deadline);

  const observed = lastError instanceof Error ? lastError.message : JSON.stringify(lastAttributes);
  throw new Error(`Timed out waiting for ${testId} ${expectation}: ${observed}`);
}

async function submitFocusedEditor(testId) {
  await waitFor(element(by.id(testId)))
    .toBeFocused()
    .withTimeout(2000);
  if (device.getPlatform() === 'android') {
    await device.getUiDevice().pressEnter();
  } else {
    await element(by.id(testId)).tapReturnKey();
    await waitFor(element(by.id(testId)))
      .not.toBeFocused()
      .withTimeout(2000);
  }
}

async function dismissFocusedEditor(testId) {
  await waitFor(element(by.id(testId)))
    .toBeFocused()
    .withTimeout(2000);
  if (device.getPlatform() === 'android') {
    await device.pressBack();
  } else {
    await element(by.id(testId)).tapReturnKey();
    await waitFor(element(by.id(testId)))
      .not.toBeFocused()
      .withTimeout(2000);
  }
}

async function advanceFocusedEditor(currentTestId, nextTestId) {
  const currentEditor = element(by.id(currentTestId));
  const nextEditor = element(by.id(nextTestId));

  await waitFor(currentEditor).toBeFocused().withTimeout(2000);
  await waitFor(nextEditor).toBeVisible().withTimeout(5000);
  if (device.getPlatform() === 'android') {
    await device.pressBack();
    await nextEditor.tap();
  } else {
    await currentEditor.tapReturnKey();
  }
  await waitFor(nextEditor).toBeFocused().withTimeout(2000);
}

async function waitForElementEnabled(testId, timeoutMs = 5000) {
  await waitForElementAttributes(
    testId,
    (attributes) => attributes?.enabled === true,
    timeoutMs,
    'to become enabled',
  );
}

async function waitForElementActionable(testId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const requireHittable = device.getPlatform() === 'ios';
  let previousFrame;
  let stableSamples = 0;
  let lastAttributes;
  let lastError;

  do {
    try {
      lastAttributes = await element(by.id(testId)).getAttributes();
      lastError = undefined;
      const candidate = attributeCandidates(lastAttributes).find(
        (attributes) =>
          attributes?.enabled === true &&
          attributes?.visible === true &&
          (!requireHittable || attributes?.hittable === true),
      );
      if (candidate) {
        const frame = JSON.stringify(candidate.frame ?? candidate.elementFrame);
        stableSamples = frame === previousFrame ? stableSamples + 1 : 1;
        previousFrame = frame;
        if (stableSamples >= 2) {
          return;
        }
      } else {
        previousFrame = undefined;
        stableSamples = 0;
      }
    } catch (error) {
      lastError = error;
      previousFrame = undefined;
      stableSamples = 0;
    }
    await sleep(100);
  } while (Date.now() < deadline);

  const observed = lastError instanceof Error ? lastError.message : JSON.stringify(lastAttributes);
  throw new Error(`Timed out waiting for ${testId} to become actionable: ${observed}`);
}

async function waitForElementPresent(testId, timeoutMs = 5000) {
  await waitForElementAttributes(
    testId,
    (attributes) => Boolean(attributes),
    timeoutMs,
    'to exist',
  );
}

async function waitForElementAbsent(testId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let consecutiveMisses = 0;
  let lastAttributes;

  do {
    try {
      lastAttributes = await element(by.id(testId)).getAttributes();
      const isMissing = attributeCandidates(lastAttributes).every((attributes) => !attributes);
      consecutiveMisses = isMissing ? consecutiveMisses + 1 : 0;
    } catch (error) {
      if (!isElementNotFoundError(error)) {
        throw error;
      }
      consecutiveMisses += 1;
    }
    if (consecutiveMisses >= 2) {
      return;
    }
    await sleep(100);
  } while (Date.now() < deadline);

  throw new Error(
    `Timed out waiting for ${testId} to remain absent: ${JSON.stringify(lastAttributes)}`,
  );
}

async function waitForElementText(testId, expectedText, timeoutMs = 5000) {
  await waitForElementAttributes(
    testId,
    (attributes) =>
      attributes?.text === expectedText ||
      attributes?.label === expectedText ||
      attributes?.value === expectedText,
    timeoutMs,
    `to display ${JSON.stringify(expectedText)}`,
  );
}

module.exports = {
  advanceFocusedEditor,
  dismissFocusedEditor,
  isElementNotFoundError,
  submitFocusedEditor,
  waitForElementAbsent,
  waitForElementActionable,
  waitForElementEnabled,
  waitForElementPresent,
  waitForElementText,
};
