import {
  parseLocaleContextDiagnosticSubtree,
  type NativeLocaleContextObservation,
} from './locale-context-validator';
import {
  parseNativeLocaleEvidence,
  qualifyNativeLocaleEvidence,
  type NativeLocaleBinding,
  type NativeLocaleEvidence,
  type SupportedNativeLocale,
} from './locale-native-observation';
import { normalizeNativeLocaleCommandOutput } from './native-locale-capture-seam';
import { readNativeEvidence } from './native-view-evidence';
import type { readAndroidNativeLocaleProperties } from './native-locale-capture-seam';

type AndroidLocalePropertyBundle = Awaited<ReturnType<typeof readAndroidNativeLocaleProperties>>;

/**
 * Runtime-only Android locale bridge for the camera producer.
 *
 * The generic hierarchy-file adapter intentionally remains preparation-only:
 * `buildNativeLocaleContextCandidateFromFile` always carries the
 * `runtime-proof-pending` blocker. Camera execution needs a separate seam that
 * reads the owned command and hierarchy produced by the same capture, builds
 * typed evidence from both, and applies the existing strict runtime qualifier.
 * This helper does not alter the generic preparation policy or manufacture a
 * locale when either owned observation is unavailable.
 */
export function readQualifiedAndroidCameraLocaleEvidence(input: {
  artifactRoot: string;
  hierarchyPath: string;
  properties: AndroidLocalePropertyBundle;
  expectedLocale: SupportedNativeLocale;
  expectedBinding: NativeLocaleBinding;
}): NativeLocaleEvidence {
  const normalized = normalizeNativeLocaleCommandOutput({
    binding: input.expectedBinding,
    command: input.properties.selected,
  });
  if (!normalized.observedOsLocale)
    throw new Error(
      `Android OS locale observation is unavailable: ${normalized.blocker ?? 'unknown'}`,
    );

  let hierarchy: unknown;
  try {
    const bytes = readNativeEvidence(input.artifactRoot, input.hierarchyPath, true);
    hierarchy = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error('Android locale hierarchy evidence is unreadable', {
      cause: error,
    });
  }

  const appObservation: NativeLocaleContextObservation =
    parseLocaleContextDiagnosticSubtree(hierarchy);
  if (appObservation.status !== 'observed')
    throw new Error(`Android app locale context is not observed: ${appObservation.reason}`);

  const evidence = parseNativeLocaleEvidence({
    schemaVersion: 1,
    requestedLocale: input.expectedLocale,
    observedOsLocale: normalized.observedOsLocale,
    effectiveAppLocale: {
      hydration: appObservation.snapshot.hydration,
      source: appObservation.snapshot.effectiveSource,
      value: appObservation.snapshot.effectiveLocale,
    },
    override: appObservation.snapshot.override,
    binding: input.expectedBinding,
  });
  const qualification = qualifyNativeLocaleEvidence(
    evidence,
    input.expectedLocale,
    input.expectedBinding,
  );
  if (!qualification.eligible)
    throw new Error(`Android camera locale runtime qualification blocked: ${qualification.reason}`);
  return structuredClone(qualification.evidence);
}
