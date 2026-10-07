import { createHash } from 'node:crypto';
import {
  verifyConnectionSnapshotCheckpoint,
  type OwnedConnectionSnapshot,
} from './native-connection-snapshot';
import { enUS } from '../../localization/en-US';

const MAX_HIERARCHY_NODES = 5000;
const MAX_HIERARCHY_DEPTH = 100;

type NativeHierarchyNode = {
  attributes?: Record<string, unknown>;
  children?: unknown[];
  [key: string]: unknown;
};

type NodePath = readonly number[];

type NodeRef = {
  node: NativeHierarchyNode;
  path: number[];
  parent: NodeRef | null;
  children: NodeRef[];
};

export type NativeConnectionTargetScope = {
  runId: string;
  scope: string;
  fixtureAuthUids: readonly string[];
  professionalAuthUid: string;
  studentAuthUid: string;
};

export type NativeConnectionHierarchyProvenance = {
  checkpoint: 'pending' | 'active';
  runId: string;
  scope: string;
  fixtureAuthUids: readonly string[];
  target: {
    professionalAuthUid: string;
    studentAuthUid: string;
    specialty: 'fitness_coach';
  };
};

export type PendingConnectionTargetMatch = {
  rowIndex: number;
  rowSelector: string;
  acceptSelector: string;
  targetPath: NodePath;
  rowPath: NodePath;
  acceptPath: NodePath;
  groupPath: NodePath;
  provenance: NativeConnectionHierarchyProvenance;
};

export type ActiveConnectionCardMatch = {
  cardIndex: number;
  cardSelector: string;
  unbindSelector: string;
  activeMarkerSelector: string;
  cardPath: NodePath;
  unbindPath: NodePath;
  activeMarkerPath: NodePath;
  provenance: NativeConnectionHierarchyProvenance;
};

export type PendingStudentConnectionCardMatch = {
  cardIndex: number;
  cardSelector: string;
  pendingMarkerSelector: string;
  pendingMarkerPath: NodePath;
  cardPath: NodePath;
  pendingText: {
    selector: string;
    attribute: 'text' | 'accessibilityText' | 'both';
    sha256: string;
    path: NodePath;
  };
  provenance: NativeConnectionHierarchyProvenance;
};

export type ProfessionalRosterTargetMatch = {
  studentSelector: string;
  studentPath: NodePath;
  assignmentState?: 'pending' | 'active';
  assignmentStateEvidence?: {
    attribute: 'accessibilityText';
    suffixSha256: string;
    path: NodePath;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function inspectHierarchy(tree: unknown): NodeRef[] {
  if (!isRecord(tree)) throw new Error('Native connection hierarchy root is malformed');

  const nodes: NodeRef[] = [];
  const seen = new WeakSet<object>();

  function visit(value: unknown, path: number[], parent: NodeRef | null, depth: number): NodeRef {
    if (!isRecord(value)) throw new Error('Native connection hierarchy node is malformed');
    if (depth > MAX_HIERARCHY_DEPTH)
      throw new Error('Native connection hierarchy exceeds its depth bound');
    if (seen.has(value)) throw new Error('Native connection hierarchy contains a cycle');
    seen.add(value);

    const attributes = value.attributes;
    if (attributes !== undefined && !isRecord(attributes))
      throw new Error('Native connection hierarchy attributes are malformed');
    const children = value.children;
    if (children !== undefined && !Array.isArray(children))
      throw new Error('Native connection hierarchy children are malformed');
    if (nodes.length >= MAX_HIERARCHY_NODES)
      throw new Error('Native connection hierarchy exceeds its node bound');

    const ref: NodeRef = {
      node: value as NativeHierarchyNode,
      path,
      parent,
      children: [],
    };
    nodes.push(ref);
    for (const [index, child] of (children ?? []).entries())
      ref.children.push(visit(child, [...path, index], ref, depth + 1));
    return ref;
  }

  visit(tree, [], null, 0);
  return nodes;
}

function resourceId(ref: NodeRef): string | null {
  const value = ref.node.attributes?.['resource-id'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function exactText(ref: NodeRef, value: string): boolean {
  return ref.node.attributes?.text === value || ref.node.attributes?.accessibilityText === value;
}

type NativeBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function bounds(ref: NodeRef): NativeBounds | null {
  const value = ref.node.attributes?.bounds;
  if (typeof value !== 'string') return null;
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value);
  if (!match) return null;
  const [, left, top, right, bottom] = match;
  const parsed = {
    left: Number(left),
    top: Number(top),
    right: Number(right),
    bottom: Number(bottom),
  };
  if (
    !Object.values(parsed).every((coordinate) => Number.isSafeInteger(coordinate)) ||
    parsed.right < parsed.left ||
    parsed.bottom < parsed.top
  )
    return null;
  return parsed;
}

function containsBounds(outer: NativeBounds, inner: NativeBounds): boolean {
  return (
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  );
}

function hasSameBounds(first: NodeRef, second: NodeRef): boolean {
  const firstBounds = bounds(first);
  const secondBounds = bounds(second);
  return (
    firstBounds !== null &&
    secondBounds !== null &&
    firstBounds.left === secondBounds.left &&
    firstBounds.top === secondBounds.top &&
    firstBounds.right === secondBounds.right &&
    firstBounds.bottom === secondBounds.bottom
  );
}

function collapseExactTextAliases(refs: readonly NodeRef[], value: string): NodeRef[] {
  return refs.filter(
    (ref) =>
      !refs.some(
        (other) =>
          other !== ref &&
          exactText(other, value) &&
          hasSameBounds(ref, other) &&
          isWithin(ref, other),
      ),
  );
}

function isEnabled(ref: NodeRef): boolean {
  const value = ref.node.enabled ?? ref.node.attributes?.enabled;
  return value === true || value === 'true';
}

function indexedResourceId(ref: NodeRef, prefix: string): number | null {
  const value = resourceId(ref);
  if (!value || !value.startsWith(prefix)) return null;
  const suffix = value.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return null;
  const index = Number(suffix);
  return Number.isSafeInteger(index) ? index : null;
}

function hasResourceId(ref: NodeRef, expected: string): boolean {
  return resourceId(ref) === expected;
}

function hasAncestorResourceId(ref: NodeRef, expected: string): boolean {
  for (let current: NodeRef | null = ref; current; current = current.parent)
    if (hasResourceId(current, expected)) return true;
  return false;
}

/**
 * iOS can expose the screen test ID as a sibling of the rendered content
 * rather than as its accessibility ancestor. Accept that one observed flat
 * layout only when the nearest host, screen marker, list card and target row
 * are all geometry-bound; a screen marker elsewhere in the tree is not
 * sufficient evidence.
 */
function hasRosterScreenContext(ref: NodeRef): boolean {
  for (let current: NodeRef | null = ref; current; current = current.parent) {
    if (hasResourceId(current, 'pro.students.screen')) return true;

    const screenMarkers = current.children.filter((child) =>
      hasResourceId(child, 'pro.students.screen'),
    );
    if (screenMarkers.length === 0) continue;
    if (screenMarkers.length !== 1) return false;

    const screen = screenMarkers[0];
    const listCards: NodeRef[] = [];
    for (let ancestor: NodeRef | null = ref; ancestor; ancestor = ancestor.parent)
      if (hasResourceId(ancestor, 'pro.students.listCard')) listCards.push(ancestor);
    if (
      listCards.length !== 1 ||
      screen.children.length !== 0 ||
      listCards[0].parent !== current ||
      !hasSameBounds(current, screen)
    )
      return false;

    const screenBounds = bounds(screen);
    const listBounds = bounds(listCards[0]);
    const rowBounds = bounds(ref);
    return (
      screenBounds !== null &&
      listBounds !== null &&
      rowBounds !== null &&
      containsBounds(screenBounds, listBounds) &&
      containsBounds(listBounds, rowBounds)
    );
  }
  return false;
}

function isWithin(ref: NodeRef, ancestor: NodeRef): boolean {
  for (let current: NodeRef | null = ref; current; current = current.parent)
    if (current === ancestor) return true;
  return false;
}

function descendants(ref: NodeRef): NodeRef[] {
  const result: NodeRef[] = [ref];
  for (const child of ref.children) result.push(...descendants(child));
  return result;
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function trustedProvenance(
  snapshot: OwnedConnectionSnapshot,
  checkpoint: 'pending' | 'active',
  target: NativeConnectionTargetScope,
): NativeConnectionHierarchyProvenance {
  const runId = requireNonEmpty(target.runId, 'Connection target run identity');
  const scope = requireNonEmpty(target.scope, 'Connection target scope');
  const fixtureAuthUids = [...target.fixtureAuthUids];
  if (
    fixtureAuthUids.length === 0 ||
    fixtureAuthUids.some((value) => !value.trim()) ||
    new Set(fixtureAuthUids).size !== fixtureAuthUids.length
  )
    throw new Error('Connection target fixture identities are invalid');
  const professionalAuthUid = requireNonEmpty(
    target.professionalAuthUid,
    'Connection target professional identity',
  );
  const studentAuthUid = requireNonEmpty(
    target.studentAuthUid,
    'Connection target student identity',
  );

  verifyConnectionSnapshotCheckpoint({
    snapshot,
    checkpoint,
    expected: {
      runId,
      scope,
      fixtureAuthUids,
      target: { professionalAuthUid, studentAuthUid, specialty: 'fitness_coach' },
    },
  });

  return {
    checkpoint,
    runId,
    scope,
    fixtureAuthUids: [...snapshot.fixtureAuthUids],
    target: { professionalAuthUid, studentAuthUid, specialty: 'fitness_coach' },
  };
}

function targetConnectionId(
  snapshot: OwnedConnectionSnapshot,
  target: NativeConnectionTargetScope,
) {
  const connections = snapshot.rows.connections.filter(
    (row) =>
      row.professionalAuthUid === target.professionalAuthUid &&
      row.studentAuthUid === target.studentAuthUid &&
      row.specialty === 'fitness_coach',
  );
  if (connections.length !== 1) throw new Error('Connection snapshot target identity is ambiguous');
  return connections[0].id;
}

function pendingGroups(nodes: readonly NodeRef[], targetRef: NodeRef) {
  const groups: {
    row: NodeRef;
    accept: NodeRef;
    target: NodeRef;
    container: NodeRef;
  }[] = [];

  for (const container of nodes) {
    const children = container.children;
    const rowStarts = children
      .map((child, index) => ({
        child,
        index,
        rowIndex: indexedResourceId(child, 'pro.pending.row.'),
      }))
      .filter(
        (entry): entry is { child: NodeRef; index: number; rowIndex: number } =>
          entry.rowIndex !== null,
      );
    for (const [startIndex, start] of rowStarts.entries()) {
      const end = rowStarts[startIndex + 1]?.index ?? children.length;
      const members = children.slice(start.index, end).flatMap(descendants);
      if (!members.includes(targetRef)) continue;

      const rows = members.filter((ref) => indexedResourceId(ref, 'pro.pending.row.') !== null);
      const accepts = members.filter(
        (ref) => indexedResourceId(ref, 'pro.pending.acceptButton.') === start.rowIndex,
      );
      const targets = members.filter((ref) => ref === targetRef);
      const rowBounds = bounds(rows[0]);
      const targetBounds = bounds(targets[0]);
      const acceptBounds = bounds(accepts[0]);
      if (
        rows.length === 1 &&
        accepts.length === 1 &&
        targets.length === 1 &&
        indexedResourceId(rows[0], 'pro.pending.row.') === start.rowIndex &&
        isEnabled(accepts[0]) &&
        hasAncestorResourceId(rows[0], 'pro.pending.screen') &&
        rowBounds !== null &&
        targetBounds !== null &&
        acceptBounds !== null &&
        containsBounds(rowBounds, targetBounds) &&
        containsBounds(rowBounds, acceptBounds)
      )
        groups.push({ row: rows[0], accept: accepts[0], target: targets[0], container });
    }
  }
  return groups;
}

/** Maps the exact pending target ID to its own row and enabled accept control. */
export function resolvePendingConnectionTarget({
  tree,
  snapshot,
  target,
}: {
  tree: unknown;
  snapshot: OwnedConnectionSnapshot;
  target: NativeConnectionTargetScope;
}): PendingConnectionTargetMatch {
  const provenance = trustedProvenance(snapshot, 'pending', target);
  const connectionId = targetConnectionId(snapshot, target);
  const nodes = inspectHierarchy(tree);
  const targetRefs = collapseExactTextAliases(
    nodes.filter((ref) => exactText(ref, connectionId)),
    connectionId,
  );
  if (targetRefs.length !== 1)
    throw new Error('Pending connection target ID is absent or duplicated');
  const groups = pendingGroups(nodes, targetRefs[0]);
  if (groups.length !== 1) throw new Error('Pending connection target row ancestry is ambiguous');
  const match = groups[0];
  const rowIndex = indexedResourceId(match.row, 'pro.pending.row.');
  if (rowIndex === null) throw new Error('Pending connection target row index is invalid');
  return {
    rowIndex,
    rowSelector: `pro.pending.row.${rowIndex}`,
    acceptSelector: `pro.pending.acceptButton.${rowIndex}`,
    targetPath: [...targetRefs[0].path],
    rowPath: [...match.row.path],
    acceptPath: [...match.accept.path],
    groupPath: [...match.container.path],
    provenance,
  };
}

/** Maps the exact active connection marker to its card and same-index End control. */
export function resolveActiveConnectionCard({
  tree,
  snapshot,
  target,
}: {
  tree: unknown;
  snapshot: OwnedConnectionSnapshot;
  target: NativeConnectionTargetScope;
}): ActiveConnectionCardMatch {
  const provenance = trustedProvenance(snapshot, 'active', target);
  const connectionId = targetConnectionId(snapshot, target);
  const nodes = inspectHierarchy(tree);
  const activeMarkerSelector = `student.professionals.activeConnection.${connectionId}`;
  const activeMarkers = nodes.filter((ref) => hasResourceId(ref, activeMarkerSelector));
  if (activeMarkers.length !== 1)
    throw new Error('Active connection identity marker is absent or duplicated');
  if (
    nodes.some((ref) =>
      hasResourceId(ref, `student.professionals.connectionPending.${connectionId}`),
    )
  )
    throw new Error('Active connection hierarchy still contains the target pending marker');

  const activeMarker = activeMarkers[0];
  const cardAncestors: NodeRef[] = [];
  for (let current: NodeRef | null = activeMarker; current; current = current.parent)
    if (indexedResourceId(current, 'student.professionals.connectionCard.') !== null)
      cardAncestors.push(current);
  if (cardAncestors.length !== 1) throw new Error('Active connection card ancestry is ambiguous');
  const card = cardAncestors[0];
  if (!hasAncestorResourceId(card, 'student.professionals.screen'))
    throw new Error('Active connection card is outside the relationships screen');
  const cardIndex = indexedResourceId(card, 'student.professionals.connectionCard.');
  if (cardIndex === null) throw new Error('Active connection card index is invalid');

  const unbindSelector = `student.professionals.unbindButton.${cardIndex}`;
  const unbindControls = descendants(card).filter((ref) => hasResourceId(ref, unbindSelector));
  if (unbindControls.length !== 1 || !isEnabled(unbindControls[0]))
    throw new Error('Active connection End control is absent, duplicated or disabled');
  if (!isWithin(activeMarker, unbindControls[0]))
    throw new Error('Active connection identity marker is detached from its End control');

  return {
    cardIndex,
    cardSelector: `student.professionals.connectionCard.${cardIndex}`,
    unbindSelector,
    activeMarkerSelector,
    cardPath: [...card.path],
    unbindPath: [...unbindControls[0].path],
    activeMarkerPath: [...activeMarker.path],
    provenance,
  };
}

function pendingTextEvidence(ref: NodeRef, selector: string, expectedGuidance: string) {
  const candidates = (['text', 'accessibilityText'] as const)
    .map((attribute) => ({ attribute, value: ref.node.attributes?.[attribute] }))
    .filter(
      (
        candidate,
      ): candidate is {
        attribute: 'text' | 'accessibilityText';
        value: string;
      } => typeof candidate.value === 'string' && candidate.value.trim().length > 0,
    );
  if (candidates.length === 0)
    throw new Error('Pending student connection guidance is absent or blank');
  const normalized = new Set(candidates.map((candidate) => candidate.value.trim()));
  if (normalized.size !== 1) throw new Error('Pending student connection guidance is ambiguous');
  const value = [...normalized][0];
  if (value !== expectedGuidance.trim())
    throw new Error('Pending student connection guidance differs from expected locale copy');
  return {
    selector,
    attribute: candidates.length === 2 ? ('both' as const) : candidates[0].attribute,
    sha256: createHash('sha256').update(value).digest('hex'),
    path: [...ref.path],
  };
}

/** Maps the exact pending student marker to its card and records redacted guidance evidence. */
export function resolvePendingStudentConnectionCard({
  tree,
  snapshot,
  target,
  expectedPendingGuidance,
}: {
  tree: unknown;
  snapshot: OwnedConnectionSnapshot;
  target: NativeConnectionTargetScope;
  expectedPendingGuidance: string;
}): PendingStudentConnectionCardMatch {
  const provenance = trustedProvenance(snapshot, 'pending', target);
  const expectedGuidance = requireNonEmpty(
    expectedPendingGuidance,
    'Expected pending student connection guidance',
  );
  const connectionId = targetConnectionId(snapshot, target);
  const nodes = inspectHierarchy(tree);
  const pendingMarkerSelector = `student.professionals.connectionPending.${connectionId}`;
  const pendingMarkers = nodes.filter((ref) => hasResourceId(ref, pendingMarkerSelector));
  if (pendingMarkers.length !== 1)
    throw new Error('Pending student connection marker is absent or duplicated');
  const pendingMarker = pendingMarkers[0];
  if (!hasAncestorResourceId(pendingMarker, 'student.professionals.screen'))
    throw new Error('Pending student connection marker is outside the relationships screen');

  const cardAncestors: NodeRef[] = [];
  for (let current: NodeRef | null = pendingMarker; current; current = current.parent)
    if (indexedResourceId(current, 'student.professionals.connectionCard.') !== null)
      cardAncestors.push(current);
  if (cardAncestors.length !== 1)
    throw new Error('Pending student connection card ancestry is ambiguous');
  const card = cardAncestors[0];
  const cardIndex = indexedResourceId(card, 'student.professionals.connectionCard.');
  if (cardIndex === null) throw new Error('Pending student connection card index is invalid');
  const cardSelector = `student.professionals.connectionCard.${cardIndex}`;
  const cardMatches = nodes.filter((ref) => hasResourceId(ref, cardSelector));
  if (cardMatches.length !== 1 || cardMatches[0] !== card)
    throw new Error('Pending student connection card is absent or duplicated');

  const activeMarkerSelector = `student.professionals.activeConnection.${connectionId}`;
  if (nodes.some((ref) => hasResourceId(ref, activeMarkerSelector)))
    throw new Error('Pending student connection hierarchy contains the target active marker');
  const unbindSelector = `student.professionals.unbindButton.${cardIndex}`;
  if (nodes.some((ref) => hasResourceId(ref, unbindSelector)))
    throw new Error('Pending student connection hierarchy contains the matching End control');

  return {
    cardIndex,
    cardSelector,
    pendingMarkerSelector,
    pendingMarkerPath: [...pendingMarker.path],
    cardPath: [...card.path],
    pendingText: pendingTextEvidence(pendingMarker, pendingMarkerSelector, expectedGuidance),
    provenance,
  };
}

/** Requires one exact professional roster row for the trusted target student. */
export function resolveProfessionalRosterTarget({
  tree,
  targetStudentAuthUid,
  assignmentState,
}: {
  tree: unknown;
  targetStudentAuthUid: string;
  assignmentState?: 'pending' | 'active';
}): ProfessionalRosterTargetMatch {
  const authUid = requireNonEmpty(targetStudentAuthUid, 'Roster target student identity');
  const nodes = inspectHierarchy(tree);
  const studentSelector = `pro.students.row.${authUid}`;
  const matches = nodes.filter((ref) => hasResourceId(ref, studentSelector));
  if (matches.length !== 1)
    throw new Error('Professional roster target row is absent or duplicated');
  if (!hasRosterScreenContext(matches[0]))
    throw new Error('Professional roster target row is outside the roster screen');
  if (
    assignmentState !== undefined &&
    assignmentState !== 'pending' &&
    assignmentState !== 'active'
  )
    throw new Error('Professional roster assignment state is invalid');
  if (assignmentState === undefined) return { studentSelector, studentPath: [...matches[0].path] };

  const statusLabel =
    assignmentState === 'active'
      ? enUS['pro.student_profile.assignment.active']
      : enUS['pro.student_profile.assignment.pending'];
  const expectedSuffix = `, ${enUS['pro.student_profile.specialty.fitness_coach']}, ${statusLabel}`;
  const accessibilityText = matches[0].node.attributes?.accessibilityText;
  if (typeof accessibilityText !== 'string')
    throw new Error('Professional roster target accessibility identity is absent');
  const normalizedText = accessibilityText.trim();
  if (
    !normalizedText.endsWith(expectedSuffix) ||
    normalizedText.slice(0, -expectedSuffix.length).trim().length === 0
  )
    throw new Error('Professional roster target specialty or assignment state mismatch');
  return {
    studentSelector,
    studentPath: [...matches[0].path],
    assignmentState,
    assignmentStateEvidence: {
      attribute: 'accessibilityText',
      suffixSha256: createHash('sha256').update(expectedSuffix).digest('hex'),
      path: [...matches[0].path],
    },
  };
}
