class CiExecutionReporter {
  constructor() {
    this.executionError = null;
  }

  onRunComplete(_contexts, results) {
    if (process.env.CI_REQUIRE_E2E_EXECUTION !== 'true') return;

    const executedTests = results.numPassedTests + results.numFailedTests;
    if (executedTests === 0) {
      this.executionError = new Error(
        'Selective Detox invocation executed no tests; refusing an all-skipped result.',
      );
    }
  }

  getLastError() {
    return this.executionError;
  }
}

module.exports = CiExecutionReporter;
