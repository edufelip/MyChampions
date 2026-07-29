async function submitFocusedEditor(testId) {
  await waitFor(element(by.id(testId))).toBeFocused().withTimeout(2000);
  if (device.getPlatform() === 'android') {
    await device.getUiDevice().pressEnter();
  } else {
    await element(by.id(testId)).tapReturnKey();
  }
}

module.exports = {
  submitFocusedEditor,
};
