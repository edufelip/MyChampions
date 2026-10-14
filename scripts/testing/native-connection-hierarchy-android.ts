import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { enUS } from '../../localization/en-US';

const MAX_HIERARCHY_NODES = 5000;
const MAX_HIERARCHY_DEPTH = 100;

type AndroidHierarchyNode = {
  attributes?: Record<string, unknown>;
  children?: unknown[];
};

type AndroidNodeRef = {
  node: AndroidHierarchyNode;
  path: number[];
  parent: AndroidNodeRef | null;
};

export type AndroidProfessionalRosterTargetMatch = {
  studentSelector: string;
  studentPath: readonly number[];
  assignmentState: 'pending' | 'active';
  assignmentStateEvidence: {
    attribute: 'accessibilityText';
    suffixSha256: string;
    path: readonly number[];
  };
};

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function inspectAndroidHierarchy(tree: unknown): AndroidNodeRef[] {
  const root = record(tree, 'Android connection hierarchy root');
  const nodes: AndroidNodeRef[] = [];
  const seen = new WeakSet<object>();

  function visit(
    value: unknown,
    path: number[],
    parent: AndroidNodeRef | null,
    depth: number,
  ): void {
    const object = record(value, 'Android connection hierarchy node');
    assert(depth <= MAX_HIERARCHY_DEPTH, 'Android connection hierarchy exceeds its depth bound');
    assert(!seen.has(object), 'Android connection hierarchy contains a cycle');
    seen.add(object);
    const attributes = object.attributes;
    if (attributes !== undefined) record(attributes, 'Android connection hierarchy attributes');
    const children = object.children;
    if (children !== undefined) assert(Array.isArray(children));
    assert(
      nodes.length < MAX_HIERARCHY_NODES,
      'Android connection hierarchy exceeds its node bound',
    );
    const ref: AndroidNodeRef = {
      node: object,
      path,
      parent,
    };
    nodes.push(ref);
    for (const [index, child] of (children ?? []).entries())
      visit(child, [...path, index], ref, depth + 1);
  }

  visit(root, [], null, 0);
  return nodes;
}

function hasRosterScreenAncestor(ref: AndroidNodeRef): boolean {
  for (let current: AndroidNodeRef | null = ref; current; current = current.parent)
    if (current.node.attributes?.['resource-id'] === 'pro.students.screen') return true;
  return false;
}

function hasRosterListCardAncestor(ref: AndroidNodeRef): boolean {
  for (let current: AndroidNodeRef | null = ref; current; current = current.parent)
    if (current.node.attributes?.['resource-id'] === 'pro.students.listCard') return true;
  return false;
}

function requireAccessibilityTextAssignment(
  ref: AndroidNodeRef,
  assignmentState: 'pending' | 'active',
): AndroidProfessionalRosterTargetMatch['assignmentStateEvidence'] {
  const statusLabel =
    assignmentState === 'active'
      ? enUS['pro.student_profile.assignment.active']
      : enUS['pro.student_profile.assignment.pending'];
  const expectedSuffix = `, ${enUS['pro.student_profile.specialty.fitness_coach']}, ${statusLabel}`;
  const accessibilityText = ref.node.attributes?.accessibilityText;
  assert(
    typeof accessibilityText === 'string' && accessibilityText.trim(),
    'Android roster target accessibility text identity is absent',
  );
  const text = ref.node.attributes?.text;
  if (typeof text === 'string' && text.trim() && text.trim() !== accessibilityText.trim())
    throw new Error('Android roster target text attributes disagree');
  const normalized = accessibilityText.trim();
  assert(
    normalized.endsWith(expectedSuffix) &&
      normalized.slice(0, -expectedSuffix.length).trim().length > 0,
    'Android roster target specialty or assignment state mismatch',
  );
  return {
    attribute: 'accessibilityText',
    suffixSha256: createHash('sha256').update(expectedSuffix).digest('hex'),
    path: [...ref.path],
  };
}

/** Resolve Android roster assignment from the retained Android accessibilityText attribute. */
export function resolveAndroidProfessionalRosterTarget(options: {
  tree: unknown;
  targetStudentAuthUid: string;
  assignmentState: 'pending' | 'active';
}): AndroidProfessionalRosterTargetMatch {
  assert(
    typeof options.targetStudentAuthUid === 'string' && options.targetStudentAuthUid.trim(),
    'Android roster target student identity is required',
  );
  const studentSelector = `pro.students.row.${options.targetStudentAuthUid}`;
  const nodes = inspectAndroidHierarchy(options.tree).filter(
    (ref) => ref.node.attributes?.['resource-id'] === studentSelector,
  );
  assert.equal(nodes.length, 1, 'Android professional roster target row is absent or duplicated');
  // Android's hierarchy can place the roster list card beside (not under) the
  // screen container. Accept a row in the roster list card when the roster
  // screen itself is present in the same tree.
  const rosterScreenPresent = inspectAndroidHierarchy(options.tree).some(
    (ref) => ref.node.attributes?.['resource-id'] === 'pro.students.screen',
  );
  assert(
    hasRosterScreenAncestor(nodes[0]) ||
      (rosterScreenPresent && hasRosterListCardAncestor(nodes[0])),
    'Android roster target row is outside the roster screen',
  );
  return {
    studentSelector,
    studentPath: [...nodes[0].path],
    assignmentState: options.assignmentState,
    assignmentStateEvidence: requireAccessibilityTextAssignment(nodes[0], options.assignmentState),
  };
}
