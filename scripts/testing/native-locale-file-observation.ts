/**
 * Private candidate for the missing locale hierarchy-file adapter.
 *
 * This is intentionally a thin file boundary over the existing bounded
 * evidence reader and preparation-only context producer. It does not read OS
 * state, reset/relaunch state, runtime metadata, or public receipt fields.
 */
import { createHash } from 'node:crypto';
import {
  buildNativeLocaleContextCandidate,
  type NativeLocaleContextCandidate,
  type NativeLocaleContextCandidateInput,
} from './locale-context-validator';
import { readNativeEvidence } from './native-view-evidence';

export type NativeLocaleHierarchyFileCandidateInput = Omit<
  NativeLocaleContextCandidateInput,
  'hierarchy' | 'hierarchyPath' | 'hierarchyHash' | 'runtimeMetadata'
> & {
  artifactRoot: string;
  hierarchyPath: string;
};

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function withBlocker(
  candidate: NativeLocaleContextCandidate,
  blocker: string,
): NativeLocaleContextCandidate {
  return {
    ...candidate,
    blockers: [...new Set([...candidate.blockers, blocker])],
  };
}

function blockedFileCandidate(
  input: NativeLocaleHierarchyFileCandidateInput,
  blocker: 'hierarchy-file-unreadable' | 'hierarchy-json-invalid',
  hierarchyHash: string | null,
): NativeLocaleContextCandidate {
  return withBlocker(
    buildNativeLocaleContextCandidate({
      hierarchy: null,
      hierarchyPath: input.hierarchyPath,
      hierarchyHash,
      binding: input.binding,
      expectedBinding: input.expectedBinding,
      observedOsLocale: input.observedOsLocale,
    }),
    blocker,
  );
}

/**
 * Read one already-written private hierarchy and produce the existing
 * preparation-only candidate. The adapter never calls the complete locale
 * qualifier, and every read/parse failure remains an explicit blocker.
 */
export function buildNativeLocaleContextCandidateFromFile(
  input: NativeLocaleHierarchyFileCandidateInput,
): NativeLocaleContextCandidate {
  let bytes: Buffer;
  try {
    // readNativeEvidence enforces the canonical owner-only root, relative path,
    // no symlink escape, regular file, 0600 mode and its existing 8 MiB cap.
    bytes = readNativeEvidence(input.artifactRoot, input.hierarchyPath, true);
  } catch {
    return blockedFileCandidate(input, 'hierarchy-file-unreadable', null);
  }

  const hierarchyHash = sha256(bytes);
  let hierarchy: unknown;
  try {
    hierarchy = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    return blockedFileCandidate(input, 'hierarchy-json-invalid', hierarchyHash);
  }

  return buildNativeLocaleContextCandidate({
    hierarchy,
    hierarchyPath: input.hierarchyPath,
    hierarchyHash,
    binding: input.binding,
    expectedBinding: input.expectedBinding,
    observedOsLocale: input.observedOsLocale,
  });
}
