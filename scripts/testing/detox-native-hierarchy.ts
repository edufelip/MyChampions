import { parser as createSaxParser, type QualifiedTag, type SAXOptions, type Tag } from 'sax';
import {
  resolveActiveConnectionCard,
  resolvePendingConnectionTarget,
  type ActiveConnectionCardMatch,
  type NativeConnectionTargetScope,
  type PendingConnectionTargetMatch,
} from './native-connection-hierarchy';
import type { OwnedConnectionSnapshot } from './native-connection-snapshot';

type DetoxPlatform = 'android' | 'ios';
type SaxTag = Tag | QualifiedTag;

type DetoxHierarchyNode = {
  attributes: Record<string, string>;
  children: DetoxHierarchyNode[];
  tagName?: string;
  enabled?: boolean;
  visible?: boolean;
  elementFrame?: DetoxElementFrame;
  hittable?: boolean;
};

export type DetoxHierarchyTree = DetoxHierarchyNode;

export type DetoxHierarchyLimits = {
  maxNodes?: number;
  maxDepth?: number;
  maxXmlCharacters?: number;
};

export type DetoxElementFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The direct object returned by an element.getAttributes() call, reduced to the
 * fields this parser reads. Other platform-specific fields pass through unread;
 * the shape is declared locally because the 'detox' package is no longer installed.
 */
export type DetoxElementAttributes = {
  identifier: string;
  enabled: boolean;
  visible: boolean;
  frame: DetoxElementFrame;
  /** Reported on iOS only. */
  hittable?: boolean;
  [field: string]: unknown;
};

/** The complete Detox getAttributes() return union, including multi-match results. */
export type DetoxElementAttributesResult =
  DetoxElementAttributes | { elements: DetoxElementAttributes[] };

export type DetoxElementAttributeEvidence = DetoxElementAttributes;

type SaxOptionsWithStrictEntities = SAXOptions & { strictEntities: boolean };

const DEFAULT_LIMITS: Required<DetoxHierarchyLimits> = Object.freeze({
  maxNodes: 5000,
  maxDepth: 100,
  maxXmlCharacters: 4 * 1024 * 1024,
});

const INTEGER = /^-?\d+$/;
const REQUIRED_VIEW_ATTRIBUTES = ['class', 'width', 'height', 'visibility', 'alpha', 'focused'];
const REQUIRED_VISIBILITY_VALUES = new Set(['visible', 'invisible', 'gone', 'unknown']);

function fail(message: string): never {
  throw new Error(`Detox view hierarchy XML ${message}`);
}

function requirePlatform(platform: DetoxPlatform): DetoxPlatform {
  if (platform !== 'android' && platform !== 'ios') fail('platform is invalid');
  return platform;
}

function requireLimits(limits: DetoxHierarchyLimits): Required<DetoxHierarchyLimits> {
  const merged = { ...DEFAULT_LIMITS, ...limits };
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value < 1) fail(`limit ${name} is invalid`);
  }
  return merged;
}

function integerAttribute(attributes: Record<string, string>, name: string, label: string): number {
  const value = attributes[name];
  if (value === undefined || !INTEGER.test(value)) fail(`${label} ${name} is not an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(`${label} ${name} is outside the safe integer range`);
  return parsed;
}

function requireViewAttributes(tag: SaxTag, path: readonly number[]): void {
  const label = `${tag.name} at ${path.length === 0 ? 'root view' : path.join('.')}`;
  const attributes = sourceAttributes(tag);
  for (const name of REQUIRED_VIEW_ATTRIBUTES) {
    if (!(name in attributes)) fail(`${label} is missing ${name}`);
  }
  if (!REQUIRED_VISIBILITY_VALUES.has(attributes.visibility))
    fail(`${label} visibility is invalid`);
  integerAttribute(attributes, 'width', label);
  integerAttribute(attributes, 'height', label);
  if (Number(attributes.width) < 0 || Number(attributes.height) < 0)
    fail(`${label} dimensions are negative`);
}

function sourceAttributes(tag: SaxTag): Record<string, string> {
  const entries = Object.entries(tag.attributes) as [string, string | { value: string }][];
  return Object.fromEntries(
    entries.map(([name, value]) => [name, typeof value === 'string' ? value : value.value]),
  );
}

function requireCoordinates(
  platform: DetoxPlatform,
  attributes: Record<string, string>,
  isPlatformRoot: boolean,
  label: string,
): { x: number; y: number } | null {
  const hasX = attributes.x !== undefined;
  const hasY = attributes.y !== undefined;
  if (!hasX && !hasY && platform === 'ios' && isPlatformRoot) return null;
  if (!hasX || !hasY) fail(`${label} has incomplete coordinates`);
  return {
    x: integerAttribute(attributes, 'x', label),
    y: integerAttribute(attributes, 'y', label),
  };
}

function addCanonicalAttributes(
  platform: DetoxPlatform,
  tag: SaxTag,
  parentOrigin: { x: number; y: number },
  isPlatformRoot: boolean,
  path: readonly number[],
): { attributes: Record<string, string>; origin: { x: number; y: number } } {
  requireViewAttributes(tag, path);
  const attributes = sourceAttributes(tag);
  const label = `${tag.name} at ${path.length === 0 ? 'root view' : path.join('.')}`;
  const coordinates = requireCoordinates(platform, attributes, isPlatformRoot, label);
  const origin =
    coordinates === null
      ? parentOrigin
      : platform === 'android'
        ? coordinates
        : { x: parentOrigin.x + coordinates.x, y: parentOrigin.y + coordinates.y };
  const width = integerAttribute(attributes, 'width', label);
  const height = integerAttribute(attributes, 'height', label);
  const right = origin.x + width;
  const bottom = origin.y + height;
  if (![origin.x, origin.y, right, bottom].every(Number.isSafeInteger))
    fail(`${label} bounds are outside the safe integer range`);
  attributes.bounds = `[${origin.x},${origin.y}][${right},${bottom}]`;

  const identifier = attributes.id;
  if (identifier !== undefined && identifier.length > 0) {
    // Detox's native XML calls this field "id" on both platforms. The existing
    // connection resolver consumes the Maestro-compatible resource-id alias.
    attributes['resource-id'] = identifier;
  }
  if (attributes.label !== undefined && attributes.label.length > 0) {
    // iOS accessibilityLabel and Android getAccessibilityLabel() are emitted as
    // "label" by the installed generators. Keep the source field as well.
    attributes.accessibilityText = attributes.label;
  }
  return { attributes, origin };
}

/**
 * Converts the installed Detox 20.47.0 XML dump into the canonical tree shape
 * consumed by native-connection-hierarchy.ts.
 *
 * Android emits <ViewHierarchy density="..."> and view attributes including
 * class/width/height/visibility/alpha/focused/value/label/x/y/text/id. iOS
 * emits the same common view attributes, omits density, and gives x/y relative
 * to the superview; its root UIWindow may omit x/y. The platform is therefore
 * required so bounds are not guessed.
 */
export function parseDetoxViewHierarchyXml(
  xml: string,
  platform: DetoxPlatform,
  limits: DetoxHierarchyLimits = {},
): DetoxHierarchyTree {
  requirePlatform(platform);
  if (typeof xml !== 'string' || xml.length === 0) fail('XML is empty');
  const resolvedLimits = requireLimits(limits);
  if (xml.length > resolvedLimits.maxXmlCharacters) fail('XML exceeds its character bound');

  let root: DetoxHierarchyNode | undefined;
  let rootClosed = false;
  // Keep the synthetic ViewHierarchy root in the same node/depth accounting
  // used by native-connection-hierarchy.ts.
  let nodes = 0;
  let parseError: Error | undefined;
  const stack: {
    name: string;
    node?: DetoxHierarchyNode;
    path: number[];
    origin: { x: number; y: number };
  }[] = [];

  const saxOptions: SaxOptionsWithStrictEntities = {
    trim: false,
    normalize: false,
    lowercase: false,
    // Namespace mode preserves every onattribute event, including duplicate
    // names that sax otherwise silently discards in non-namespace mode.
    xmlns: true,
    strictEntities: true,
  };
  const parser = createSaxParser(true, saxOptions);

  parser.onprocessinginstruction = (instruction) => {
    if (instruction.name.toLowerCase() !== 'xml')
      fail('contains an unexpected processing instruction');
  };
  parser.ondoctype = () => fail('DOCTYPE is not allowed');
  parser.oncomment = () => undefined;
  parser.oncdata = () => undefined;
  parser.ontext = (text) => {
    if (text.trim().length > 0) fail('contains unexpected text content');
  };
  parser.onerror = (error) => {
    parseError = error;
    parser.resume();
  };
  let openTagAttributes: Set<string> | undefined;
  parser.onopentagstart = () => {
    openTagAttributes = new Set<string>();
  };
  parser.onattribute = ({ name }) => {
    if (!openTagAttributes) fail('contains an attribute outside an opening tag');
    if (openTagAttributes.has(name)) fail(`contains duplicate ${name} XML attribute`);
    openTagAttributes.add(name);
  };
  parser.onopentag = (tag) => {
    openTagAttributes = undefined;
    if (rootClosed) fail('contains content after the root element');
    if (stack.length === 0) {
      if (tag.name !== 'ViewHierarchy') fail('root element is not ViewHierarchy');
      root = {
        attributes: sourceAttributes(tag),
        children: [],
        tagName: tag.name,
      };
      nodes = 1;
      stack.push({
        name: tag.name,
        node: root,
        path: [],
        origin: { x: 0, y: 0 },
      });
      return;
    }
    if (stack[0].name !== 'ViewHierarchy') fail('view is outside ViewHierarchy');
    const parent = stack[stack.length - 1];
    if (!parent.node) fail('parent node is missing');
    const path = [...parent.path, parent.node.children.length];
    const isPlatformRoot = parent.name === 'ViewHierarchy';
    const canonical = addCanonicalAttributes(platform, tag, parent.origin, isPlatformRoot, path);
    const node: DetoxHierarchyNode = {
      attributes: canonical.attributes,
      children: [],
      tagName: tag.name,
    };
    parent.node.children.push(node);
    nodes += 1;
    if (nodes > resolvedLimits.maxNodes) fail('exceeds its node bound');
    // stack contains the synthetic ViewHierarchy root, so this is the depth
    // that inspectHierarchy() will observe for the new view node.
    const depth = stack.length;
    if (depth > resolvedLimits.maxDepth) fail('exceeds its depth bound');
    stack.push({
      name: tag.name,
      node,
      path,
      origin: canonical.origin,
    });
  };
  parser.onclosetag = (name) => {
    const current = stack.pop();
    if (!current || current.name !== name) fail('has mismatched closing tags');
    if (stack.length === 0) {
      if (name !== 'ViewHierarchy') fail('root closing tag is invalid');
      rootClosed = true;
    }
  };

  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof Error) parseError ??= error;
    else parseError ??= new Error(String(error));
  }
  if (parseError) fail(`is malformed: ${parseError.message}`);
  if (!root || !rootClosed || stack.length !== 0) fail('is incomplete');
  return root;
}

function walkTree(tree: DetoxHierarchyTree): DetoxHierarchyNode[] {
  const nodes: DetoxHierarchyNode[] = [];
  const seen = new Set<DetoxHierarchyNode>();
  function visit(node: DetoxHierarchyNode): void {
    if (seen.has(node)) fail('canonical tree contains a cycle');
    seen.add(node);
    nodes.push(node);
    for (const child of node.children) visit(child);
  }
  visit(tree);
  return nodes;
}

function requirePendingAcceptAncestry(tree: DetoxHierarchyTree): void {
  function visit(node: DetoxHierarchyNode, ancestors: readonly string[]): void {
    const identifier = node.attributes['resource-id'];
    const match = /^pro\.pending\.acceptButton\.(\d+)$/.exec(identifier ?? '');
    if (match && !ancestors.includes(`pro.pending.row.${match[1]}`))
      fail(`pending accept control ${identifier} is detached from its row`);
    const nextAncestors = identifier ? [...ancestors, identifier] : ancestors;
    for (const child of node.children) visit(child, nextAncestors);
  }
  visit(tree, []);
}

function requireElementAttributes(value: unknown): DetoxElementAttributeEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('element attributes are malformed');
  const attributes = value as Record<string, unknown>;
  if (typeof attributes.identifier !== 'string' || attributes.identifier.length === 0)
    fail('element attributes identifier is missing');
  if (typeof attributes.enabled !== 'boolean' || typeof attributes.visible !== 'boolean')
    fail(`element attributes for ${attributes.identifier} lack enabled/visible booleans`);
  if (!attributes.frame || typeof attributes.frame !== 'object' || Array.isArray(attributes.frame))
    fail(`element attributes frame for ${attributes.identifier} is malformed`);
  const frame = attributes.frame as Record<string, unknown>;
  for (const key of ['x', 'y'] as const)
    if (typeof frame[key] !== 'number' || !Number.isFinite(frame[key]))
      fail(`element attributes frame for ${attributes.identifier} is invalid`);
  for (const key of ['width', 'height'] as const)
    if (typeof frame[key] !== 'number' || !Number.isFinite(frame[key]) || frame[key] < 0)
      fail(`element attributes frame for ${attributes.identifier} is invalid`);
  if ('hittable' in attributes && typeof attributes.hittable !== 'boolean')
    fail(`element attributes hittable for ${attributes.identifier} is invalid`);
  return attributes as unknown as DetoxElementAttributeEvidence;
}

/**
 * Detox returns either one platform-specific object or an object containing
 * `elements` when the matcher has multiple results. The bridge requires one
 * identity-bound result for each selector; a multi-match result is ambiguous.
 */
export function normalizeDetoxElementAttributes(
  value: DetoxElementAttributesResult,
): DetoxElementAttributeEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('element attributes result is malformed');
  if ('elements' in value) {
    if (!Array.isArray(value.elements)) fail('element attributes elements is malformed');
    if (value.elements.length !== 1)
      fail('element attributes result must identify exactly one element');
    return requireElementAttributes(value.elements[0]);
  }
  return requireElementAttributes(value);
}

/**
 * Preserves identity-bound getAttributes() facts separately from XML. Read-only
 * observations may be non-actionable; the action resolvers enforce visibility,
 * frame and platform-specific hittability without inferring them from parsing.
 */
export function applyDetoxElementAttributeEvidence(
  tree: DetoxHierarchyTree,
  evidence: DetoxElementAttributesResult | readonly DetoxElementAttributesResult[],
): DetoxHierarchyTree {
  const nodes = walkTree(tree);
  const seenEvidence = new Set<string>();
  const results: readonly DetoxElementAttributesResult[] = Array.isArray(evidence)
    ? evidence
    : [evidence];
  for (const raw of results) {
    const item = normalizeDetoxElementAttributes(raw);
    if (seenEvidence.has(item.identifier))
      fail(`element attributes ${item.identifier} are duplicated`);
    seenEvidence.add(item.identifier);
    const matches = nodes.filter((node) => node.attributes['resource-id'] === item.identifier);
    if (matches.length === 0) fail(`element attributes ${item.identifier} do not match XML`);
    if (matches.length > 1) fail(`semantic identifier ${item.identifier} is duplicated`);
    matches[0].enabled = item.enabled;
    matches[0].visible = item.visible;
    matches[0].elementFrame = { ...item.frame };
    if ('hittable' in item) matches[0].hittable = item.hittable;
  }
  return tree;
}

/** Validate observed action facts without inferring iOS hittability on Android. */
function requireDetoxActionableElement(
  value: DetoxElementAttributesResult,
  platform: DetoxPlatform,
): DetoxElementAttributeEvidence {
  const attributes = normalizeDetoxElementAttributes(value);
  if (!attributes.enabled || !attributes.visible)
    fail(`element ${attributes.identifier} is disabled or invisible`);
  if (attributes.frame.width <= 0 || attributes.frame.height <= 0)
    fail(`element ${attributes.identifier} has an empty action frame`);
  if (platform === 'ios' && (!('hittable' in attributes) || attributes.hittable !== true))
    fail(`element ${attributes.identifier} lacks observed iOS hittability`);
  return attributes;
}

export function resolvePendingConnectionTargetFromDetoxXml({
  xml,
  platform,
  snapshot,
  target,
  elementAttributes,
}: {
  xml: string;
  platform: DetoxPlatform;
  snapshot: OwnedConnectionSnapshot;
  target: NativeConnectionTargetScope;
  elementAttributes: DetoxElementAttributesResult;
}): PendingConnectionTargetMatch {
  const attributes = requireDetoxActionableElement(elementAttributes, platform);
  const tree = parseDetoxViewHierarchyXml(xml, platform);
  applyDetoxElementAttributeEvidence(tree, attributes);
  requirePendingAcceptAncestry(tree);
  return resolvePendingConnectionTarget({ tree, snapshot, target });
}

export function resolveActiveConnectionCardFromDetoxXml({
  xml,
  platform,
  snapshot,
  target,
  elementAttributes,
}: {
  xml: string;
  platform: DetoxPlatform;
  snapshot: OwnedConnectionSnapshot;
  target: NativeConnectionTargetScope;
  elementAttributes: DetoxElementAttributesResult;
}): ActiveConnectionCardMatch {
  const attributes = requireDetoxActionableElement(elementAttributes, platform);
  const tree = parseDetoxViewHierarchyXml(xml, platform);
  applyDetoxElementAttributeEvidence(tree, attributes);
  return resolveActiveConnectionCard({ tree, snapshot, target });
}
