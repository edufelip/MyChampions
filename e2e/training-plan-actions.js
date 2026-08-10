async function scrollTrainingPlanControlIntoView(testId) {
  await waitFor(element(by.id(testId)))
    .toBeVisible()
    .whileElement(by.id('pro.training_plan.screen'))
    .scroll(260, 'down', 0.5, 0.35);
}

async function scrollToTrainingPlanSave() {
  await scrollTrainingPlanControlIntoView('pro.training_plan.saveButton');
}

async function scrollToTrainingPlanSaveAboveNavigation() {
  await scrollToTrainingPlanSave();
  await element(by.id('pro.training_plan.screen')).scroll(120, 'down', 0.5, 0.5);
  await waitFor(element(by.id('pro.training_plan.saveButton')))
    .toBeVisible()
    .withTimeout(5000);
}

module.exports = {
  scrollTrainingPlanControlIntoView,
  scrollToTrainingPlanSave,
  scrollToTrainingPlanSaveAboveNavigation,
};
