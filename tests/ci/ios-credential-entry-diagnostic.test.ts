import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectIosCredentialEntryDiagnostic,
  iosCredentialEntryDiagnosticSelectors as selectors,
  type IosCredentialEntryDiagnosticAction,
  type IosCredentialEntryDiagnosticAppBoundary,
  type IosCredentialEntryDiagnosticEvidence,
  type IosCredentialEntryDiagnosticKeyboardState,
  type IosCredentialEntryDiagnosticSnapshot,
} from '../../scripts/testing/ios-credential-entry-diagnostic';

const digest = (character: string): string => character.repeat(64);

function hierarchy(emailText: string, focused?: boolean): Record<string, unknown> {
  return {
    attributes: {},
    children: [
      {
        attributes: {
          'resource-id': selectors.email,
          text: emailText,
          bounds: '[21,301][381,351]',
          ...(focused === undefined ? {} : { focused }),
        },
        children: [],
      },
      {
        attributes: {
          'resource-id': selectors.password,
          text: '',
          bounds: '[21,365][381,415]',
        },
        children: [],
      },
      {
        attributes: {
          'resource-id': selectors.submit,
          bounds: '[21,430][381,480]',
        },
        children: [],
      },
    ],
  };
}

function action(
  kind: IosCredentialEntryDiagnosticAction['kind'],
  status: IosCredentialEntryDiagnosticAction['status'] = 'completed',
  overrides: Partial<IosCredentialEntryDiagnosticAction> = {},
): IosCredentialEntryDiagnosticAction {
  return {
    kind,
    status,
    selector: kind === 'observation' ? null : selectors.email,
    retryCount: 0,
    coordinatesUsed: false,
    optionalAssertionsUsed: false,
    credentialValueRecorded: false,
    ...overrides,
  };
}

function evidence(sequence: number, incomplete = false): IosCredentialEntryDiagnosticEvidence {
  const hierarchyCharacters = ['a', 'b', 'c'] as const;
  const screenshotCharacters = ['d', 'e', 'f'] as const;
  const commandCharacters = ['0', '1', '2'] as const;
  return {
    hierarchySha256: incomplete ? null : digest(hierarchyCharacters[sequence]),
    screenshotSha256: incomplete ? null : digest(screenshotCharacters[sequence]),
    commandReceiptSha256: digest(commandCharacters[sequence]),
  };
}

function snapshot(
  stage: IosCredentialEntryDiagnosticSnapshot['stage'],
  sequence: number,
  emailText: string,
  options: {
    focused?: boolean;
    keyboard?: IosCredentialEntryDiagnosticKeyboardState;
    appBoundary?: IosCredentialEntryDiagnosticAppBoundary;
    action?: IosCredentialEntryDiagnosticAction;
    sameFieldStatus?: 'passed' | 'failed';
    hierarchy?: unknown;
    incompleteEvidence?: boolean;
  } = {},
): IosCredentialEntryDiagnosticSnapshot {
  const actionValue =
    options.action ??
    action(
      stage === 'entry' ? 'observation' : stage === 'email-after-tap' ? 'tap-email' : 'input-email',
    );
  const hierarchyValue = Object.hasOwn(options, 'hierarchy')
    ? options.hierarchy
    : hierarchy(emailText, options.focused);
  return {
    stage,
    sequence,
    hierarchy: hierarchyValue,
    keyboard: options.keyboard ?? (stage === 'entry' ? 'hidden' : 'visible'),
    appBoundary: options.appBoundary ?? 'same-app-instance',
    action: actionValue,
    evidence: evidence(sequence, options.incompleteEvidence),
    ...(options.sameFieldStatus
      ? {
          sameFieldAssertion: {
            selector: selectors.email,
            status: options.sameFieldStatus,
            exactValueBound: true as const,
          },
        }
      : {}),
  };
}

function successfulSnapshots(emailText = 'private-value@example.invalid') {
  return [
    snapshot('entry', 0, ''),
    snapshot('email-after-tap', 1, '', { focused: true }),
    snapshot('email-after-input', 2, emailText, {
      focused: true,
      sameFieldStatus: 'passed',
    }),
  ] as const;
}

void test('source-only projection records focus, keyboard, value state and exact assertion without raw values', () => {
  const rawValue = 'private-value@example.invalid';
  const result = collectIosCredentialEntryDiagnostic(successfulSnapshots(rawValue));
  assert.equal(result.status, 'observed');
  assert.equal(result.nativeQualification, 'Pending');
  assert.equal(result.publicPromotionEligible, false);
  assert.equal(result.credentialsRetained, false);
  assert.equal(result.rawHierarchyValuesRetained, false);
  assert.equal(result.observedStages[1].email.focus, 'focused');
  assert.equal(result.observedStages[1].email.bounds, '[21,301][381,351]');
  assert.equal(result.observedStages[1].keyboard, 'visible');
  assert.equal(result.observedStages[2].email.value, 'nonempty');
  assert.equal(result.observedStages[2].sameFieldAssertion, 'passed');
  assert.equal(result.reloadObservation, 'not-observed');
  assert.equal(JSON.stringify(result).includes(rawValue), false);
  assert.equal(JSON.stringify(result).includes('Save Password?'), false);
});

void test('missing native focus metadata and keyboard observation remain unknown instead of becoming a cause', () => {
  const result = collectIosCredentialEntryDiagnostic([
    snapshot('entry', 0, '', { keyboard: 'unknown', appBoundary: 'unknown' }),
    snapshot('email-after-tap', 1, '', {
      keyboard: 'unknown',
      appBoundary: 'unknown',
    }),
    snapshot('email-after-input', 2, 'private-value', {
      keyboard: 'unknown',
      appBoundary: 'unknown',
      sameFieldStatus: 'passed',
    }),
  ]);
  assert.equal(result.status, 'observed');
  assert.equal(result.observedStages[1].email.focus, 'unknown');
  assert.equal(result.observedStages[1].keyboard, 'unknown');
  assert.equal(result.reloadObservation, 'unknown');
});

void test('same-field assertion failure preserves the failed attempt and empty field state', () => {
  const result = collectIosCredentialEntryDiagnostic([
    snapshot('entry', 0, ''),
    snapshot('email-after-tap', 1, '', { focused: true }),
    snapshot('email-after-input', 2, '', {
      focused: true,
      sameFieldStatus: 'failed',
    }),
  ]);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failure, {
    stage: 'email-after-input',
    reason: 'exact-same-field-assertion-failed',
  });
  assert.equal(result.observedStages[2].email.value, 'empty');
  assert.equal(result.observedStages[2].email.focus, 'focused');
});

void test('action failure preserves the failed stage even when the hierarchy and screenshot are unavailable', () => {
  const result = collectIosCredentialEntryDiagnostic([
    snapshot('entry', 0, ''),
    snapshot('email-after-tap', 1, '', {
      hierarchy: null,
      action: action('tap-email', 'failed'),
      incompleteEvidence: true,
    }),
  ]);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failure, {
    stage: 'email-after-tap',
    reason: 'action-failed',
  });
  assert.equal(result.observedStages[1].email.presence, 'unknown');
  assert.equal(result.observedStages[1].email.value, 'unknown');
});

void test('a missing exact assertion is blocked rather than converted into a successful input observation', () => {
  const result = collectIosCredentialEntryDiagnostic([
    snapshot('entry', 0, ''),
    snapshot('email-after-tap', 1, '', { focused: true }),
    snapshot('email-after-input', 2, 'private-value', { focused: true }),
  ]);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.failure, {
    stage: 'email-after-input',
    reason: 'exact-same-field-assertion-not-recorded',
  });
});

void test('relaunch boundary is retained as an observation and does not infer a reload cause', () => {
  const result = collectIosCredentialEntryDiagnostic([
    snapshot('entry', 0, '', { appBoundary: 'same-app-instance' }),
    snapshot('email-after-tap', 1, '', {
      focused: true,
      appBoundary: 'same-app-instance',
    }),
    snapshot('email-after-input', 2, 'private-value', {
      focused: true,
      appBoundary: 'relaunch-observed',
      sameFieldStatus: 'passed',
    }),
  ]);
  assert.equal(result.reloadObservation, 'observed');
  assert.equal(result.status, 'observed');
});

void test('retry, coordinate, optional assertion and credential metadata are rejected', () => {
  const mutations: [string, Partial<IosCredentialEntryDiagnosticAction>][] = [
    ['retry', { retryCount: 1 }],
    ['coordinates', { coordinatesUsed: true }],
    ['optional assertion', { optionalAssertionsUsed: true }],
    ['credential value', { credentialValueRecorded: true as never }],
  ];
  for (const [label, mutation] of mutations)
    assert.throws(
      () =>
        collectIosCredentialEntryDiagnostic([
          snapshot('entry', 0, '', {
            action: action('observation', 'completed', mutation),
          }),
        ]),
      /does not permit|cannot retain credential values/,
      label,
    );
});

void test('unapproved action keys and malformed stage evidence fail closed', () => {
  const actionWithRawValue = {
    ...action('observation'),
    value: 'private-value@example.invalid',
  } as never;
  assert.throws(
    () =>
      collectIosCredentialEntryDiagnostic([
        snapshot('entry', 0, '', { action: actionWithRawValue }),
      ]),
    /unapproved or sensitive metadata/,
  );
  assert.throws(
    () =>
      collectIosCredentialEntryDiagnostic([
        snapshot('entry', 0, '', {
          hierarchy: { attributes: {}, children: 'bad' },
        }),
      ]),
    /children must be an array/,
  );
  assert.throws(
    () =>
      collectIosCredentialEntryDiagnostic([
        snapshot('entry', 0, '', {
          hierarchy: {
            attributes: {},
            children: [{ attributes: { 'resource-id': selectors.email, bounds: 'bad' } }],
          },
        }),
      ]),
    /target bounds are malformed/,
  );
  assert.throws(
    () =>
      collectIosCredentialEntryDiagnostic([snapshot('entry', 0, '', { incompleteEvidence: true })]),
    /completed action requires hierarchy and screenshot evidence/,
  );
});

void test('stage ordering, exact selector binding and exact-value binding are mandatory', () => {
  assert.throws(
    () =>
      collectIosCredentialEntryDiagnostic([
        snapshot('entry', 0, ''),
        snapshot('email-after-input', 1, 'private-value', {
          sameFieldStatus: 'passed',
        }),
      ]),
    /stages must be contiguous and ordered/,
  );
  assert.throws(
    () =>
      collectIosCredentialEntryDiagnostic([
        snapshot('entry', 0, ''),
        snapshot('email-after-tap', 1, ''),
        {
          ...snapshot('email-after-input', 2, 'private-value'),
          sameFieldAssertion: {
            selector: selectors.password,
            status: 'passed',
            exactValueBound: true,
          },
        } as never,
      ]),
    /selector is not exact/,
  );
  assert.throws(
    () =>
      collectIosCredentialEntryDiagnostic([
        snapshot('entry', 0, ''),
        snapshot('email-after-tap', 1, ''),
        {
          ...snapshot('email-after-input', 2, 'private-value'),
          sameFieldAssertion: {
            selector: selectors.email,
            status: 'passed',
            exactValueBound: false,
          },
        } as never,
      ]),
    /not bound to the exact input/,
  );
});
