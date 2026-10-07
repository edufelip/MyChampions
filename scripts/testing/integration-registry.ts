export const INTEGRATION_PROJECTS = {
  chromium: { browser: 'chromium', locale: 'en-US', device: 'Desktop Chrome' },
  firefox: { browser: 'firefox', locale: 'en-US', device: 'Desktop Firefox' },
  webkit: { browser: 'webkit', locale: 'en-US', device: 'Desktop Safari' },
  'mobile-en': { browser: 'chromium', locale: 'en-US', device: 'Pixel 5' },
  'mobile-pt': { browser: 'chromium', locale: 'pt-BR', device: 'Pixel 5' },
  'mobile-es': { browser: 'chromium', locale: 'es-ES', device: 'Pixel 5' },
  'tablet-en': { browser: 'chromium', locale: 'en-US', device: 'iPad Mini' },
  'tablet-pt': { browser: 'chromium', locale: 'pt-BR', device: 'iPad Mini' },
  'tablet-es': { browser: 'chromium', locale: 'es-ES', device: 'iPad Mini' },
} as const;
export type IntegrationProject = keyof typeof INTEGRATION_PROJECTS;
export type Scenario = {
  id: string;
  implemented: boolean;
  spec: string;
  requirements: string[];
  assertions: { id: string; refs: string[] }[];
};
const authDocs = [
  'docs/screens/v2/SC-217-auth-sign-in.md',
  'docs/screens/v2/SC-218-auth-create-account.md',
  'docs/screens/v2/SC-221-auth-accept-terms.md',
  'docs/screens/v2/SC-201-auth-role-selection.md',
  'docs/acceptance-criteria/AC-002-role-journeys-and-plan-ownership.md',
  'docs/test-cases/TC-002-role-and-assignment-controls.md',
];
export const INTEGRATION_SCENARIOS: Scenario[] = [
  {
    id: 'auth-session',
    implemented: true,
    spec: 'auth-session.spec.ts',
    requirements: authDocs,
    assertions: [
      { id: 'create-account-login', refs: ['SC-218', 'AC-228', 'BL-018/T11.1'] },
      { id: 'terms-role-persisted', refs: ['SC-221', 'SC-201', 'AC-266'] },
      { id: 'http-only-cookie', refs: ['SC-217/browser-session'] },
      { id: 'reload-session-rotation', refs: ['SC-217/browser-session', 'BL-018/T11.1'] },
      { id: 'sign-out-revocation', refs: ['SC-217/browser-session', 'BL-018/T11.1'] },
      { id: 'normal-login-restore', refs: ['SC-217', 'BL-018/T11.1'] },
      { id: 'owned-client-origin', refs: ['BL-018/T10'] },
    ],
  },
  {
    id: 'training-durable',
    implemented: true,
    spec: 'training-durable.spec.ts',
    requirements: [
      'docs/screens/v2/SC-208-training-plan-builder.md',
      'docs/screens/v2/SC-217-auth-sign-in.md',
      'docs/use-cases/UC-002-role-onboarding-and-care-management.md',
      'docs/acceptance-criteria/AC-002-role-journeys-and-plan-ownership.md',
      'docs/business-rules/BR-002-role-assignment-and-plan-governance.md',
      'docs/plans/2026-09-28-testing-structure-and-maestro-plan.md',
    ],
    assertions: [
      { id: 'normal-coach-login', refs: ['SC-217', 'SC-208'] },
      { id: 'local-draft-no-mutation', refs: ['SC-208/local-draft', 'BL-018/T11.2'] },
      { id: 'ui-create-exercise', refs: ['SC-208', 'UC-002.22', 'BR-294'] },
      { id: 'create-api-sql-match', refs: ['SC-208', 'AC-223', 'BL-018/T11.2'] },
      { id: 'ui-edit-api-sql-match', refs: ['SC-208', 'UC-002.22', 'BR-294'] },
      { id: 'restart-reload-durable', refs: ['SC-208', 'BL-018/T11.2'] },
      { id: 'fixture-template-unchanged', refs: ['BL-018/T11.2'] },
      { id: 'owned-client-catalog-origin', refs: ['SC-208/catalog-service', 'BL-018/T10'] },
    ],
  },
  {
    id: 'connection-approval',
    implemented: true,
    spec: 'connection-approval.spec.ts',
    requirements: [
      'docs/screens/v2/SC-211-relationship-management.md',
      'docs/screens/v2/SC-204-professional-home-dashboard.md',
      'docs/screens/v2/SC-205-student-roster.md',
      'docs/use-cases/UC-002-role-onboarding-and-care-management.md',
      'docs/acceptance-criteria/AC-002-role-journeys-and-plan-ownership.md',
      'docs/business-rules/BR-002-role-assignment-and-plan-governance.md',
    ],
    assertions: [
      { id: 'independent-ui-logins', refs: ['SC-217', 'BL-018/T11.3'] },
      { id: 'professional-ui-invite-code', refs: ['SC-204', 'AC-213'] },
      { id: 'student-ui-pending-request', refs: ['SC-211', 'UC-002.3', 'BR-230'] },
      { id: 'pending-api-sql-both-contexts', refs: ['AC-214', 'BR-230A'] },
      { id: 'professional-ui-confirmation', refs: ['UC-002.3', 'AC-214'] },
      { id: 'active-ui-api-sql-both-contexts', refs: ['SC-211', 'SC-205', 'BR-230A'] },
      { id: 'seeded-domain-unchanged', refs: ['BL-018/T11.3'] },
      { id: 'owned-two-context-origins', refs: ['BL-018/T10', 'BL-018/T11.3'] },
    ],
  },
  {
    id: 'save-retry',
    implemented: true,
    spec: 'save-retry.spec.ts',
    requirements: [
      'docs/screens/v2/SC-208-training-plan-builder.md',
      'docs/use-cases/UC-002-role-onboarding-and-care-management.md',
      'docs/acceptance-criteria/AC-002-role-journeys-and-plan-ownership.md',
      'docs/business-rules/BR-002-role-assignment-and-plan-governance.md',
      'docs/plans/2026-09-28-testing-structure-and-maestro-plan.md',
    ],
    assertions: [
      { id: 'normal-login-baseline', refs: ['SC-217', 'BL-018/T11.4'] },
      { id: 'ui-local-draft-no-write', refs: ['SC-208', 'UC-002.22', 'BR-294'] },
      { id: 'private-once-fault-armed', refs: ['BL-018/T11.4', 'BL-018/16'] },
      { id: 'failed-save-retains-draft-error-no-write', refs: ['SC-208', 'BL-018/T11.4'] },
      { id: 'cleared-fault-ui-retry-success', refs: ['SC-208', 'BL-018/T11.4'] },
      { id: 'exact-one-durable-change', refs: ['AC-223', 'BR-294', 'BL-018/T11.4'] },
      { id: 'restart-reload-no-duplicate', refs: ['SC-208', 'BL-018/T11.4'] },
      { id: 'owned-save-catalog-origin', refs: ['SC-208/catalog-service', 'BL-018/T10'] },
    ],
  },
  {
    id: 'unrelated-denial',
    implemented: true,
    spec: 'unrelated-denial.spec.ts',
    requirements: [
      'docs/screens/v2/SC-208-training-plan-builder.md',
      'docs/screens/v2/SC-217-auth-sign-in.md',
      'docs/plans/2026-09-28-testing-structure-and-maestro-plan.md',
    ],
    assertions: [
      { id: 'independent-ui-identities', refs: ['SC-217', 'BL-018/T11.5'] },
      { id: 'existing-owner-api-sql-baseline', refs: ['SC-208/private-library', 'BL-018/T11.5'] },
      { id: 'unrelated-ui-read-denied', refs: ['SC-208/private-library', 'BL-018/T11.5'] },
      { id: 'unrelated-ui-retry-denied', refs: ['SC-208/private-library', 'BL-018/T11.5'] },
      { id: 'unrelated-update-denied', refs: ['BL-018/T11.5', 'BL-018/20'] },
      { id: 'unrelated-delete-denied', refs: ['BL-018/T11.5', 'BL-018/20'] },
      { id: 'restart-owner-state-unchanged', refs: ['BL-018/T11.5'] },
      { id: 'owned-denial-origin', refs: ['BL-018/T10'] },
    ],
  },
];

export function parseIntegrationArguments(argv: readonly string[]) {
  const inputs = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--(scenario|project|deadline-ms)=(.+)$/.exec(arg);
    if (!match || inputs.has(match[1]))
      throw new Error('Invalid or duplicate integration argument');
    inputs.set(match[1], match[2]);
  }
  const scenarios = (
    inputs.get('scenario') ?? INTEGRATION_SCENARIOS.map((row) => row.id).join(',')
  ).split(',');
  const projects = (inputs.get('project') ?? Object.keys(INTEGRATION_PROJECTS).join(',')).split(
    ',',
  );
  if (new Set(scenarios).size !== scenarios.length || new Set(projects).size !== projects.length)
    throw new Error('Duplicate integration selection');
  const selected = scenarios.map((id) => INTEGRATION_SCENARIOS.find((row) => row.id === id));
  if (
    selected.some((row) => !row) ||
    projects.some((id) => !Object.hasOwn(INTEGRATION_PROJECTS, id))
  )
    throw new Error('Unknown integration scenario or project');
  const deadlineMs = Number(inputs.get('deadline-ms') ?? 600_000);
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 3_600_000)
    throw new Error('Invalid integration deadline');
  return {
    scenarios: selected as Scenario[],
    projects: projects as IntegrationProject[],
    deadlineMs,
  };
}
export function assertRunnableIntegrationSelection(
  selection: ReturnType<typeof parseIntegrationArguments>,
) {
  if (selection.scenarios.some((row) => !row.implemented))
    throw new Error('Requested integration scenario is not implemented');
}
export const integrationAttemptId = (scenario: string, project: string) =>
  `${scenario}--${project}`;
export const integrationFixtureScope = (scenario: string, project: string) =>
  `${scenario}-${project}`;
