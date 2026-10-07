/**
 * Canonical-ready T15 parser for the LocaleContext diagnostic subtree.
 *
 * This parser deliberately does not require a language-selection screen. A
 * coach/home hierarchy can prove the redacted context snapshot on its own;
 * the separate selection audit below adds the option/checkmark contract only
 * for a locale-selection scenario.
 */
import {
  parseNativeLocaleEvidence,
  parseNativeLocaleBinding,
  sameNativeLocaleBinding,
  SUPPORTED_NATIVE_LOCALES,
  type NativeLocaleBinding,
  type NativeLocaleEvidence,
  type SupportedNativeLocale,
} from './locale-native-observation';

export type ContextLocaleHydration = 'pending' | 'hydrated' | 'read-error' | 'unobserved';
export type ContextLocaleOverride = 'present' | 'absent' | 'invalid' | 'read-error' | 'unobserved';

export type LocaleContextDiagnosticSnapshot = {
  hydration: ContextLocaleHydration;
  effectiveSource: 'LocaleContext' | 'unobserved';
  effectiveLocale: SupportedNativeLocale | null;
  override: {
    status: ContextLocaleOverride;
    source: 'language-storage' | 'unobserved';
    value: SupportedNativeLocale | null;
  };
};

export type NativeLocaleContextHierarchyNode = {
  attributes?: Record<string, unknown>;
  children?: unknown[];
};

export type NativeLocaleContextBlockReason =
  | 'malformed-hierarchy'
  | 'diagnostic-missing'
  | 'diagnostic-ambiguous'
  | 'diagnostic-subtree-malformed'
  | 'unsupported-diagnostic-value'
  | 'hydration-status-missing'
  | 'hydration-status-ambiguous'
  | 'effective-locale-missing'
  | 'effective-locale-ambiguous'
  | 'effective-locale-unexpected'
  | 'override-status-missing'
  | 'override-status-ambiguous'
  | 'override-value-missing'
  | 'override-value-ambiguous'
  | 'override-value-unexpected'
  | 'override-effective-mismatch';

export type NativeLocaleContextObservation =
  | {
      status: 'observed';
      snapshot: LocaleContextDiagnosticSnapshot;
    }
  | {
      status: 'blocked';
      reason: NativeLocaleContextBlockReason;
    };

export type LocaleSelectionAuditBlockReason =
  | NativeLocaleContextBlockReason
  | 'language-screen-missing'
  | 'language-screen-ambiguous'
  | 'locale-option-missing'
  | 'locale-option-ambiguous'
  | 'selected-locale-missing'
  | 'selected-locale-ambiguous'
  | 'selected-locale-mismatch';

export type NativeLocaleSelectionObservation =
  | {
      status: 'observed';
      selectedLocale: SupportedNativeLocale;
      snapshot: LocaleContextDiagnosticSnapshot;
    }
  | {
      status: 'blocked';
      reason: LocaleSelectionAuditBlockReason;
    };

export type NativeLocaleContextCandidate = {
  kind: 'native-locale-context-candidate-not-runtime-proof';
  status: 'preparation-only';
  runtimeQualification: 'pending';
  nativePassingCases: 0;
  publicLocale: null;
  runtimeBoundary: {
    hydratedDevice: 'pending';
    reset: 'pending';
    relaunch: 'pending';
    cleanup: 'pending';
  };
  treePath: string | null;
  treeHash: string | null;
  appObservation: NativeLocaleContextObservation;
  evidence: NativeLocaleEvidence | null;
  binding: NativeLocaleBinding | null;
  observedOsLocale: NativeLocaleEvidence['observedOsLocale'] | null;
  blockers: readonly string[];
};

type FlatNode = {
  node: NativeLocaleContextHierarchyNode;
  id: string | null;
};

const HASH64 = /^[a-f0-9]{64}$/;
const MAX_TREE_PATH = 512;
const MAX_NODES = 10_000;
const DIAGNOSTIC_ROOT = 'testing.locale.diagnostic';
const DIAGNOSTIC_PREFIXES = [
  'testing.locale.hydration.',
  'testing.locale.effective.',
  'testing.locale.override.',
  'testing.locale.overrideValue.',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSupportedLocale(value: unknown): value is SupportedNativeLocale {
  return SUPPORTED_NATIVE_LOCALES.includes(value as SupportedNativeLocale);
}

function isHydration(value: string): value is ContextLocaleHydration {
  return ['pending', 'hydrated', 'read-error', 'unobserved'].includes(value);
}

function isOverride(value: string): value is ContextLocaleOverride {
  return ['present', 'absent', 'invalid', 'read-error', 'unobserved'].includes(value);
}

function normalizeId(value: string): string {
  return value.replace(/^[^:]+:id\//, '');
}

function nodeId(node: NativeLocaleContextHierarchyNode): string | null {
  if (!isRecord(node.attributes)) return null;
  const value =
    node.attributes['resource-id'] ??
    node.attributes.testID ??
    node.attributes.identifier ??
    node.attributes['accessibility-id'];
  return typeof value === 'string' && value.length > 0 ? normalizeId(value) : null;
}

function flattenTree(value: unknown): { nodes: FlatNode[]; malformed: boolean } {
  if (!isRecord(value)) return { nodes: [], malformed: true };
  const nodes: FlatNode[] = [];
  const seen = new Set<object>();
  const pending: unknown[] = [value];
  let malformed = false;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!isRecord(current)) {
      malformed = true;
      continue;
    }
    if (seen.has(current)) {
      malformed = true;
      continue;
    }
    seen.add(current);
    if (nodes.length >= MAX_NODES) {
      malformed = true;
      break;
    }
    const node = current as NativeLocaleContextHierarchyNode;
    if (node.children !== undefined && !Array.isArray(node.children)) {
      malformed = true;
      continue;
    }
    nodes.push({ node, id: nodeId(node) });
    if (Array.isArray(node.children)) pending.push(...node.children);
  }
  return { nodes, malformed };
}

function descendants(value: unknown): { ids: string[]; malformed: boolean } {
  const result = flattenTree(value);
  return {
    ids: result.nodes.flatMap((entry) => (entry.id === null ? [] : [entry.id])),
    malformed: result.malformed,
  };
}

function exactMatches(ids: readonly string[], prefix: string): string[] {
  return ids.filter((id) => id.startsWith(prefix));
}

function unsupportedDiagnosticId(ids: readonly string[]): boolean {
  return ids.some((id) => {
    if (id === DIAGNOSTIC_ROOT) return false;
    const prefix = DIAGNOSTIC_PREFIXES.find((candidate) => id.startsWith(candidate));
    if (!prefix) return id.startsWith('testing.locale.');
    const value = id.slice(prefix.length);
    if (prefix === 'testing.locale.hydration.') return !isHydration(value);
    if (prefix === 'testing.locale.override.') return !isOverride(value);
    return !isSupportedLocale(value);
  });
}

function oneValue<T extends string>(
  ids: readonly string[],
  prefix: string,
  isValue: (value: string) => value is T,
): T | null | 'ambiguous' | 'unsupported' {
  const matches = exactMatches(ids, prefix);
  if (matches.length === 0) return null;
  if (matches.length > 1) return 'ambiguous';
  const value = matches[0].slice(prefix.length);
  return isValue(value) ? value : 'unsupported';
}

function parseDiagnosticIds(ids: readonly string[]): NativeLocaleContextObservation {
  if (unsupportedDiagnosticId(ids))
    return { status: 'blocked', reason: 'unsupported-diagnostic-value' };

  const hydration = oneValue(ids, 'testing.locale.hydration.', isHydration);
  if (hydration === null) return { status: 'blocked', reason: 'hydration-status-missing' };
  if (hydration === 'ambiguous' || hydration === 'unsupported')
    return {
      status: 'blocked',
      reason:
        hydration === 'ambiguous' ? 'hydration-status-ambiguous' : 'unsupported-diagnostic-value',
    };

  const effective = oneValue(ids, 'testing.locale.effective.', isSupportedLocale);
  if (effective === 'ambiguous') return { status: 'blocked', reason: 'effective-locale-ambiguous' };
  if (effective === 'unsupported')
    return { status: 'blocked', reason: 'unsupported-diagnostic-value' };
  if (hydration === 'hydrated' && effective === null)
    return { status: 'blocked', reason: 'effective-locale-missing' };
  if (hydration !== 'hydrated' && effective !== null)
    return { status: 'blocked', reason: 'effective-locale-unexpected' };

  const override = oneValue(ids, 'testing.locale.override.', isOverride);
  if (override === null) return { status: 'blocked', reason: 'override-status-missing' };
  if (override === 'ambiguous' || override === 'unsupported')
    return {
      status: 'blocked',
      reason:
        override === 'ambiguous' ? 'override-status-ambiguous' : 'unsupported-diagnostic-value',
    };

  const overrideValue = oneValue(ids, 'testing.locale.overrideValue.', isSupportedLocale);
  if (overrideValue === 'ambiguous')
    return { status: 'blocked', reason: 'override-value-ambiguous' };
  if (overrideValue === 'unsupported')
    return { status: 'blocked', reason: 'unsupported-diagnostic-value' };
  if (override === 'present' && overrideValue === null)
    return { status: 'blocked', reason: 'override-value-missing' };
  if (override !== 'present' && overrideValue !== null)
    return { status: 'blocked', reason: 'override-value-unexpected' };

  const snapshot: LocaleContextDiagnosticSnapshot = {
    hydration,
    effectiveSource: hydration === 'hydrated' ? 'LocaleContext' : 'unobserved',
    effectiveLocale: hydration === 'hydrated' ? effective : null,
    override: {
      status: override,
      source: override === 'unobserved' ? 'unobserved' : 'language-storage',
      value: override === 'present' ? overrideValue : null,
    },
  };
  if (
    snapshot.override.status === 'present' &&
    snapshot.override.value !== snapshot.effectiveLocale
  )
    return { status: 'blocked', reason: 'override-effective-mismatch' };
  return { status: 'observed', snapshot };
}

/**
 * Parse only the diagnostic subtree. IDs from sibling coach/home content are
 * ignored, while IDs inside the subtree are required to be closed and exact.
 */
export function parseLocaleContextDiagnosticSubtree(tree: unknown): NativeLocaleContextObservation {
  const flattened = flattenTree(tree);
  if (flattened.malformed || flattened.nodes.length === 0)
    return { status: 'blocked', reason: 'malformed-hierarchy' };
  const roots = flattened.nodes.filter((entry) => entry.id === DIAGNOSTIC_ROOT);
  if (roots.length === 0) return { status: 'blocked', reason: 'diagnostic-missing' };
  if (roots.length > 1) return { status: 'blocked', reason: 'diagnostic-ambiguous' };
  const rootChildren = roots[0].node.children ?? [];
  const subtree = descendants({ children: rootChildren });
  if (subtree.malformed) return { status: 'blocked', reason: 'diagnostic-subtree-malformed' };
  return parseDiagnosticIds(subtree.ids);
}

function screenIds(tree: unknown): { ids: string[]; malformed: boolean; count: number } {
  const flattened = flattenTree(tree);
  const screens = flattened.nodes.filter((entry) => entry.id === 'settings.languageSelect.screen');
  if (screens.length !== 1)
    return { ids: [], malformed: flattened.malformed, count: screens.length };
  const subtree = descendants(screens[0].node);
  return {
    ids: subtree.ids,
    malformed: flattened.malformed || subtree.malformed,
    count: screens.length,
  };
}

/**
 * Add the language-selection option/checkmark contract for the locale screen.
 * This is intentionally separate from the generic coach/home context parser.
 */
export function parseLocaleSelectionScenario(tree: unknown): NativeLocaleSelectionObservation {
  const context = parseLocaleContextDiagnosticSubtree(tree);
  if (context.status === 'blocked') return context;

  const selection = screenIds(tree);
  if (selection.malformed) return { status: 'blocked', reason: 'malformed-hierarchy' };
  if (selection.count === 0) return { status: 'blocked', reason: 'language-screen-missing' };
  if (selection.count > 1) return { status: 'blocked', reason: 'language-screen-ambiguous' };

  for (const locale of SUPPORTED_NATIVE_LOCALES) {
    const count = selection.ids.filter(
      (id) => id === `settings.languageSelect.option.${locale}`,
    ).length;
    if (count === 0) return { status: 'blocked', reason: 'locale-option-missing' };
    if (count > 1) return { status: 'blocked', reason: 'locale-option-ambiguous' };
  }
  const selected = SUPPORTED_NATIVE_LOCALES.filter(
    (locale) =>
      selection.ids.filter((id) => id === `settings.languageSelect.option.${locale}.checkmark`)
        .length > 0,
  );
  if (selected.length === 0) return { status: 'blocked', reason: 'selected-locale-missing' };
  if (selected.length > 1) return { status: 'blocked', reason: 'selected-locale-ambiguous' };
  const checkmarkCount = selection.ids.filter((id) => id.endsWith('.checkmark')).length;
  if (checkmarkCount !== 1) return { status: 'blocked', reason: 'selected-locale-ambiguous' };
  if (context.snapshot.hydration === 'hydrated' && selected[0] !== context.snapshot.effectiveLocale)
    return { status: 'blocked', reason: 'selected-locale-mismatch' };
  return { status: 'observed', selectedLocale: selected[0], snapshot: context.snapshot };
}

export type NativeLocaleContextCandidateInput = {
  hierarchy: unknown;
  hierarchyPath: unknown;
  hierarchyHash: unknown;
  binding: unknown;
  expectedBinding?: unknown;
  observedOsLocale: unknown;
  /** Source-shaped metadata is accepted only to prove it is ignored. */
  runtimeMetadata?: unknown;
};

function validTreePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TREE_PATH &&
    value.trim() === value &&
    !value.startsWith('/') &&
    !value.split('/').includes('..') &&
    ![...value].some((character) => character < ' ' || character === '\u007f')
  );
}

function validTreeHash(value: unknown): value is string {
  return typeof value === 'string' && HASH64.test(value);
}

function fallbackSnapshot(): LocaleContextDiagnosticSnapshot {
  return {
    hydration: 'unobserved',
    effectiveSource: 'unobserved',
    effectiveLocale: null,
    override: { status: 'unobserved', source: 'unobserved', value: null },
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Bind a context observation to the captured tree and source/build identity.
 * The returned packet is preparation-only; it cannot qualify a runtime case.
 */
export function buildNativeLocaleContextCandidate(
  input: NativeLocaleContextCandidateInput,
): NativeLocaleContextCandidate {
  const treePath = validTreePath(input.hierarchyPath) ? input.hierarchyPath : null;
  const treeHash = validTreeHash(input.hierarchyHash) ? input.hierarchyHash : null;
  const appObservation = parseLocaleContextDiagnosticSubtree(input.hierarchy);
  const blockers: string[] = [];
  if (treePath === null) blockers.push('hierarchy-path-invalid');
  if (treeHash === null) blockers.push('hierarchy-hash-invalid');
  if (appObservation.status === 'blocked') blockers.push(`hierarchy-${appObservation.reason}`);
  if (!Object.prototype.hasOwnProperty.call(input, 'expectedBinding'))
    blockers.push('expected-binding-missing');
  if (Object.prototype.hasOwnProperty.call(input, 'runtimeMetadata'))
    blockers.push('runtime-metadata-source-shaped-ignored');

  const snapshot =
    appObservation.status === 'observed' ? appObservation.snapshot : fallbackSnapshot();
  let evidence: NativeLocaleEvidence | null = null;
  let binding: NativeLocaleBinding | null = null;
  let observedOsLocale: NativeLocaleEvidence['observedOsLocale'] | null = null;
  try {
    evidence = parseNativeLocaleEvidence({
      schemaVersion: 1,
      requestedLocale: null,
      observedOsLocale: input.observedOsLocale,
      effectiveAppLocale: {
        hydration: snapshot.hydration,
        source: snapshot.effectiveSource,
        value: snapshot.effectiveLocale,
      },
      override: snapshot.override,
      binding: input.binding,
    });
    binding = evidence.binding;
    observedOsLocale = evidence.observedOsLocale;
  } catch {
    blockers.push('context-evidence-malformed');
  }

  if (Object.prototype.hasOwnProperty.call(input, 'expectedBinding')) {
    try {
      const expectedBinding = parseNativeLocaleBinding(input.expectedBinding);
      if (binding !== null && !sameNativeLocaleBinding(binding, expectedBinding))
        blockers.push('binding-stale');
    } catch {
      blockers.push('expected-binding-malformed');
    }
  }
  blockers.push('runtime-proof-pending');

  return {
    kind: 'native-locale-context-candidate-not-runtime-proof',
    status: 'preparation-only',
    runtimeQualification: 'pending',
    nativePassingCases: 0,
    publicLocale: null,
    runtimeBoundary: {
      hydratedDevice: 'pending',
      reset: 'pending',
      relaunch: 'pending',
      cleanup: 'pending',
    },
    treePath,
    treeHash,
    appObservation,
    evidence,
    binding,
    observedOsLocale,
    blockers: unique(blockers),
  };
}
