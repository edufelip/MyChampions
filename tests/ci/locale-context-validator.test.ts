import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNativeLocaleContextCandidate,
  parseLocaleContextDiagnosticSubtree,
  parseLocaleSelectionScenario,
  type LocaleContextDiagnosticSnapshot,
  type NativeLocaleContextHierarchyNode,
  type NativeLocaleContextCandidateInput,
} from '../../scripts/testing/locale-context-validator';
import type { NativeLocaleBinding } from '../../scripts/testing/locale-native-observation';

type SupportedLocale = 'en-US' | 'pt-BR' | 'es-ES';

const binding: NativeLocaleBinding = {
  captureRunId: 'a'.repeat(24),
  sourceTreeHash: '1'.repeat(64),
  helperInputsHash: '2'.repeat(64),
  target: {
    platform: 'ios',
    deviceId: 'owned-target',
    osVersion: 'iOS-26-5',
    appId: 'com.edufelip.mychampions.dev',
    binaryHash: '3'.repeat(64),
    apiOrigin: 'http://127.0.0.1:61251',
  },
};

const observedOsLocale = {
  status: 'observed' as const,
  source: 'ios-simctl-defaults' as const,
  raw: 'en_US',
  resolved: 'en-US' as const,
  normalization: 'platform-canonical' as const,
};

function node(
  id?: string,
  children: NativeLocaleContextHierarchyNode[] = [],
): NativeLocaleContextHierarchyNode {
  return {
    ...(id ? { attributes: { 'resource-id': id } } : {}),
    children,
  };
}

function diagnosticIds(snapshot: LocaleContextDiagnosticSnapshot): string[] {
  const ids = [
    'testing.locale.diagnostic',
    `testing.locale.hydration.${snapshot.hydration}`,
    `testing.locale.override.${snapshot.override.status}`,
  ];
  if (snapshot.effectiveLocale) ids.push(`testing.locale.effective.${snapshot.effectiveLocale}`);
  if (snapshot.override.value) ids.push(`testing.locale.overrideValue.${snapshot.override.value}`);
  return ids;
}

function diagnosticTree(
  snapshot: LocaleContextDiagnosticSnapshot,
  prefix = '',
  diagnosticAttributes: 'resource-id' | 'testID' = 'resource-id',
): NativeLocaleContextHierarchyNode {
  const diagnosticChildren = diagnosticIds(snapshot)
    .slice(1)
    .map((id) => ({
      attributes: { [diagnosticAttributes]: `${prefix}${id}` },
      children: [],
    }));
  return node('coach.home.screen', [
    node('coach.home.card', [
      {
        attributes: { [diagnosticAttributes]: `${prefix}${diagnosticIds(snapshot)[0]}` },
        children: diagnosticChildren,
      },
    ]),
    node('unrelated.user-facing.copy'),
  ]);
}

function snapshot(
  hydration: LocaleContextDiagnosticSnapshot['hydration'],
  effectiveLocale: SupportedLocale | null,
  override: LocaleContextDiagnosticSnapshot['override'],
): LocaleContextDiagnosticSnapshot {
  return {
    hydration,
    effectiveSource: hydration === 'hydrated' ? 'LocaleContext' : 'unobserved',
    effectiveLocale: hydration === 'hydrated' ? effectiveLocale : null,
    override,
  };
}

function selectionTree(selected: SupportedLocale): NativeLocaleContextHierarchyNode {
  const context = snapshot('hydrated', selected, {
    status: 'absent',
    source: 'language-storage',
    value: null,
  });
  const options = (['en-US', 'pt-BR', 'es-ES'] as const).map((locale) =>
    node(`settings.languageSelect.option.${locale}`, [
      ...(locale === selected ? [node(`settings.languageSelect.option.${locale}.checkmark`)] : []),
    ]),
  );
  const diagnostic = diagnosticIds(context);
  return node('app.root', [
    node('settings.languageSelect.screen', options),
    node(
      diagnostic[0],
      diagnostic.slice(1).map((id) => node(id)),
    ),
  ]);
}

function candidateInput(
  hierarchy: unknown,
  overrides: Partial<NativeLocaleContextCandidateInput> = {},
): NativeLocaleContextCandidateInput {
  return {
    hierarchy,
    hierarchyPath: 'coach/home-hierarchy.json',
    hierarchyHash: '4'.repeat(64),
    binding,
    expectedBinding: binding,
    observedOsLocale,
    ...overrides,
  };
}

void test('parses a hydrated coach tree without requiring language-selection controls', () => {
  const tree = diagnosticTree(
    snapshot('hydrated', 'en-US', {
      status: 'absent',
      source: 'language-storage',
      value: null,
    }),
    '',
    'testID',
  );
  const result = parseLocaleContextDiagnosticSubtree(tree);
  assert.deepEqual(result, {
    status: 'observed',
    snapshot: snapshot('hydrated', 'en-US', {
      status: 'absent',
      source: 'language-storage',
      value: null,
    }),
  });
});

void test('parses an Android home tree with package-prefixed IDs and read-error status', () => {
  const result = parseLocaleContextDiagnosticSubtree(
    diagnosticTree(
      snapshot('read-error', null, {
        status: 'read-error',
        source: 'language-storage',
        value: null,
      }),
      'com.edufelip.mychampions.dev:id/',
    ),
  );
  assert.equal(result.status, 'observed');
  if (result.status === 'observed') {
    assert.equal(result.snapshot.hydration, 'read-error');
    assert.equal(result.snapshot.effectiveLocale, null);
  }
});

void test('keeps invalid and unobserved values explicit without inventing effective locale', () => {
  const invalid = parseLocaleContextDiagnosticSubtree(
    diagnosticTree(
      snapshot('hydrated', 'en-US', {
        status: 'invalid',
        source: 'language-storage',
        value: null,
      }),
    ),
  );
  const pending = parseLocaleContextDiagnosticSubtree(
    diagnosticTree(
      snapshot('pending', null, {
        status: 'unobserved',
        source: 'unobserved',
        value: null,
      }),
    ),
  );
  assert.equal(invalid.status, 'observed');
  assert.equal(pending.status, 'observed');
  if (invalid.status === 'observed') assert.equal(invalid.snapshot.override.status, 'invalid');
  if (pending.status === 'observed') assert.equal(pending.snapshot.effectiveLocale, null);
});

void test('ignores unrelated sibling IDs but rejects missing, duplicate, and unsupported diagnostics', () => {
  const valid = diagnosticTree(
    snapshot('hydrated', 'pt-BR', {
      status: 'present',
      source: 'language-storage',
      value: 'pt-BR',
    }),
  );
  const siblingIds = valid.children ?? [];
  siblingIds.push(node('testing.locale.effective.fr-FR'));
  assert.equal(parseLocaleContextDiagnosticSubtree(valid).status, 'observed');

  const missing = diagnosticTree(
    snapshot('hydrated', 'en-US', {
      status: 'absent',
      source: 'language-storage',
      value: null,
    }),
  );
  const missingCard = missing.children?.[0] as NativeLocaleContextHierarchyNode | undefined;
  const missingRoot = missingCard?.children?.[0] as NativeLocaleContextHierarchyNode | undefined;
  if (missingRoot?.children)
    missingRoot.children = missingRoot.children.filter((child: unknown) => {
      const id = (child as NativeLocaleContextHierarchyNode).attributes?.['resource-id'];
      return id !== 'testing.locale.hydration.hydrated';
    });
  assert.deepEqual(parseLocaleContextDiagnosticSubtree(missing), {
    status: 'blocked',
    reason: 'hydration-status-missing',
  });

  const duplicate = diagnosticTree(
    snapshot('hydrated', 'en-US', {
      status: 'absent',
      source: 'language-storage',
      value: null,
    }),
  );
  const duplicateCard = duplicate.children?.[0] as NativeLocaleContextHierarchyNode | undefined;
  const duplicateRoot = duplicateCard?.children?.[0] as
    NativeLocaleContextHierarchyNode | undefined;
  if (duplicateRoot?.children)
    duplicateRoot.children.push(node('testing.locale.hydration.hydrated'));
  assert.deepEqual(parseLocaleContextDiagnosticSubtree(duplicate), {
    status: 'blocked',
    reason: 'hydration-status-ambiguous',
  });

  const unsupported = diagnosticTree(
    snapshot('hydrated', 'en-US', {
      status: 'absent',
      source: 'language-storage',
      value: null,
    }),
  );
  const unsupportedCard = unsupported.children?.[0] as NativeLocaleContextHierarchyNode | undefined;
  const unsupportedRoot = unsupportedCard?.children?.[0] as
    NativeLocaleContextHierarchyNode | undefined;
  if (unsupportedRoot?.children)
    unsupportedRoot.children.push(node('testing.locale.effective.fr-FR'));
  assert.deepEqual(parseLocaleContextDiagnosticSubtree(unsupported), {
    status: 'blocked',
    reason: 'unsupported-diagnostic-value',
  });
});

void test('rejects contradictory present override and effective locale', () => {
  const result = parseLocaleContextDiagnosticSubtree(
    diagnosticTree(
      snapshot('hydrated', 'en-US', {
        status: 'present',
        source: 'language-storage',
        value: 'pt-BR',
      }),
    ),
  );
  assert.deepEqual(result, { status: 'blocked', reason: 'override-effective-mismatch' });
});

void test('keeps option/checkmark auditing separate and required for locale selection', () => {
  const coach = diagnosticTree(
    snapshot('hydrated', 'en-US', {
      status: 'absent',
      source: 'language-storage',
      value: null,
    }),
  );
  assert.deepEqual(parseLocaleSelectionScenario(coach), {
    status: 'blocked',
    reason: 'language-screen-missing',
  });

  const selected = parseLocaleSelectionScenario(selectionTree('pt-BR'));
  assert.deepEqual(selected, {
    status: 'observed',
    selectedLocale: 'pt-BR',
    snapshot: snapshot('hydrated', 'pt-BR', {
      status: 'absent',
      source: 'language-storage',
      value: null,
    }),
  });
});

void test('selection audit rejects missing option and duplicate checkmark controls', () => {
  const missingOption = selectionTree('en-US');
  const screen = missingOption.children?.[0] as NativeLocaleContextHierarchyNode | undefined;
  if (screen?.children)
    screen.children = screen.children.filter((child: unknown) => {
      const id = (child as NativeLocaleContextHierarchyNode).attributes?.['resource-id'];
      return id !== 'settings.languageSelect.option.es-ES';
    });
  assert.deepEqual(parseLocaleSelectionScenario(missingOption), {
    status: 'blocked',
    reason: 'locale-option-missing',
  });

  const duplicateCheckmark = selectionTree('en-US');
  const duplicateScreen = duplicateCheckmark.children?.[0] as
    NativeLocaleContextHierarchyNode | undefined;
  const selectedOption = duplicateScreen?.children?.[0] as
    NativeLocaleContextHierarchyNode | undefined;
  if (selectedOption?.children)
    selectedOption.children.push(node('settings.languageSelect.option.en-US.checkmark'));
  assert.deepEqual(parseLocaleSelectionScenario(duplicateCheckmark), {
    status: 'blocked',
    reason: 'selected-locale-ambiguous',
  });
});

void test('producer binds a valid coach capture to tree hash and source/build identity while staying pending', () => {
  const tree = diagnosticTree(
    snapshot('hydrated', 'en-US', {
      status: 'absent',
      source: 'language-storage',
      value: null,
    }),
  );
  const result = buildNativeLocaleContextCandidate(candidateInput(tree));
  assert.equal(result.status, 'preparation-only');
  assert.equal(result.runtimeQualification, 'pending');
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.publicLocale, null);
  assert.deepEqual(result.runtimeBoundary, {
    hydratedDevice: 'pending',
    reset: 'pending',
    relaunch: 'pending',
    cleanup: 'pending',
  });
  assert.equal(result.treePath, 'coach/home-hierarchy.json');
  assert.equal(result.treeHash, '4'.repeat(64));
  assert.deepEqual(result.binding, binding);
  assert.equal(result.evidence?.requestedLocale, null);
  assert.equal(result.evidence?.effectiveAppLocale.value, 'en-US');
  assert.deepEqual(result.observedOsLocale, observedOsLocale);
  assert.deepEqual(result.blockers, ['runtime-proof-pending']);
});

void test('producer retains blocked hierarchy and rejects unsafe tree metadata without projection', () => {
  const result = buildNativeLocaleContextCandidate(
    candidateInput(
      { attributes: { 'resource-id': 'coach.home.screen' }, children: [] },
      {
        hierarchyPath: '/private/tree.json',
        hierarchyHash: 'not-a-sha',
      },
    ),
  );
  assert.deepEqual(result.appObservation, { status: 'blocked', reason: 'diagnostic-missing' });
  assert.equal(result.treePath, null);
  assert.equal(result.treeHash, null);
  assert.equal(result.runtimeQualification, 'pending');
  assert.equal(result.nativePassingCases, 0);
  assert.deepEqual(result.blockers, [
    'hierarchy-path-invalid',
    'hierarchy-hash-invalid',
    'hierarchy-diagnostic-missing',
    'runtime-proof-pending',
  ]);
  assert.equal(result.appObservation.status, 'blocked');

  const traversal = buildNativeLocaleContextCandidate(
    candidateInput(
      diagnosticTree(
        snapshot('pending', null, {
          status: 'unobserved',
          source: 'unobserved',
          value: null,
        }),
      ),
      { hierarchyPath: 'coach/../tree.json' },
    ),
  );
  assert.equal(traversal.treePath, null);
  assert.ok(traversal.blockers.includes('hierarchy-path-invalid'));
});

void test('producer preserves an OS read-error as pending and refuses malformed source binding', () => {
  const tree = diagnosticTree(
    snapshot('read-error', null, {
      status: 'read-error',
      source: 'language-storage',
      value: null,
    }),
  );
  const pendingOs = buildNativeLocaleContextCandidate(
    candidateInput(tree, {
      observedOsLocale: {
        status: 'read-error',
        source: 'ios-simctl-defaults',
        raw: null,
        resolved: null,
        normalization: 'none',
      },
    }),
  );
  assert.equal(pendingOs.runtimeQualification, 'pending');
  assert.equal(pendingOs.observedOsLocale?.status, 'read-error');
  assert.equal(pendingOs.evidence?.effectiveAppLocale.value, null);

  const malformedBinding = buildNativeLocaleContextCandidate(
    candidateInput(tree, { binding: { ...binding, sourceTreeHash: 'not-a-sha' } }),
  );
  assert.equal(malformedBinding.evidence, null);
  assert.equal(malformedBinding.binding, null);
  assert.ok(malformedBinding.blockers.includes('context-evidence-malformed'));
});

void test('stale source/build binding and source-shaped runtime metadata cannot qualify or project a locale', () => {
  const tree = diagnosticTree(
    snapshot('hydrated', 'pt-BR', {
      status: 'present',
      source: 'language-storage',
      value: 'pt-BR',
    }),
  );
  const result = buildNativeLocaleContextCandidate(
    candidateInput(tree, {
      expectedBinding: { ...binding, sourceTreeHash: '9'.repeat(64) },
      runtimeMetadata: {
        hydratedDevice: { status: 'observed', value: 'pt-BR' },
        reset: { status: 'observed' },
        relaunch: { status: 'observed' },
        cleanup: { status: 'observed' },
      },
    }),
  );
  assert.deepEqual(result.blockers, [
    'runtime-metadata-source-shaped-ignored',
    'binding-stale',
    'runtime-proof-pending',
  ]);
  assert.equal(result.publicLocale, null);
  assert.equal(result.runtimeQualification, 'pending');
  assert.equal(result.nativePassingCases, 0);
});

void test('missing or malformed expected binding remains an explicit freshness error', () => {
  const tree = diagnosticTree(
    snapshot('hydrated', 'en-US', {
      status: 'absent',
      source: 'language-storage',
      value: null,
    }),
  );
  const withoutExpectedBinding = { ...candidateInput(tree) };
  delete withoutExpectedBinding.expectedBinding;
  const missing = buildNativeLocaleContextCandidate(withoutExpectedBinding);
  assert.ok(missing.blockers.includes('expected-binding-missing'));
  const malformed = buildNativeLocaleContextCandidate(
    candidateInput(tree, { expectedBinding: { captureRunId: 'stale' } }),
  );
  assert.ok(malformed.blockers.includes('expected-binding-malformed'));
  assert.equal(malformed.publicLocale, null);
});
