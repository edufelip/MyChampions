import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export type DetoxCancelUiEvidence = Readonly<{
  hierarchyFile: string;
  hierarchySha256: string;
  screenshotFile: string;
  screenshotSha256: string;
  modalPresent: false;
  accountScreenPresent: true;
}>;

export type ParsedDetoxHierarchyNode = Readonly<{
  name: string;
  attributes: Readonly<Record<string, string>>;
}>;

const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Bounded XML parser for Detox hierarchy receipts; regex substring checks are not accepted. */
export function parseDetoxHierarchyXml(value: string): readonly ParsedDetoxHierarchyNode[] {
  if (Buffer.byteLength(value, 'utf8') === 0 || Buffer.byteLength(value, 'utf8') > 512 * 1024)
    throw new Error('Detox hierarchy XML is outside its bound');
  const nodes: ParsedDetoxHierarchyNode[] = [];
  const stack: string[] = [];
  let rootCount = 0;
  let offset = 0;
  const token = /<!--[\s\S]*?-->|<\?[^>]*\?>|<!DOCTYPE[^>]*>|<[^>]+>/gi;
  for (const match of value.matchAll(token)) {
    const text = value.slice(offset, match.index ?? 0);
    if (text.trim() && stack.length === 0)
      throw new Error('Detox hierarchy has text outside its root');
    offset = (match.index ?? 0) + match[0].length;
    const raw = match[0];
    if (raw.startsWith('<!--') || raw.startsWith('<?') || /^<!DOCTYPE/i.test(raw)) continue;
    if (/^<\//.test(raw)) {
      const name = raw.slice(2, -1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name) || stack.pop() !== name)
        throw new Error('Detox hierarchy XML has an invalid closing tag');
      continue;
    }
    const selfClosing = /\/\s*>$/.test(raw);
    const body = raw.slice(1, selfClosing ? -2 : -1).trim();
    const nameMatch = /^([A-Za-z_][A-Za-z0-9_.:-]*)/.exec(body);
    if (!nameMatch) throw new Error('Detox hierarchy XML has an invalid opening tag');
    const name = nameMatch[1];
    const rest = body.slice(name.length);
    const attributes: Record<string, string> = {};
    let consumed = 0;
    const attrPattern = /\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/g;
    for (const attr of rest.matchAll(attrPattern)) {
      if ((attr.index ?? 0) !== consumed)
        throw new Error('Detox hierarchy XML has malformed attributes');
      const key = attr[1];
      if (Object.hasOwn(attributes, key))
        throw new Error('Detox hierarchy XML repeats an attribute');
      attributes[key] = decodeXml(attr[2]);
      consumed = (attr.index ?? 0) + attr[0].length;
    }
    if (rest.slice(consumed).trim())
      throw new Error('Detox hierarchy XML has malformed attributes');
    if (stack.length === 0) rootCount++;
    nodes.push(Object.freeze({ name, attributes: Object.freeze(attributes) }));
    if (!selfClosing) stack.push(name);
  }
  if (value.slice(offset).trim() || stack.length !== 0 || rootCount !== 1 || nodes.length === 0)
    throw new Error('Detox hierarchy XML is not a complete rooted tree');
  return Object.freeze(nodes);
}

function selectorValue(value: string, selector: string) {
  return value === selector || value.endsWith(`:id/${selector}`) || value.endsWith(`/${selector}`);
}

function hasSelector(nodes: readonly ParsedDetoxHierarchyNode[], selector: string) {
  return nodes.some((node) =>
    Object.values(node.attributes).some((value) => selectorValue(value, selector)),
  );
}

function validatePng(bytes: Buffer) {
  if (bytes.subarray(0, pngSignature.length).compare(pngSignature) !== 0)
    throw new Error('Detox cancel screenshot is not a PNG');
  if (bytes.length < 33) throw new Error('Detox cancel screenshot lacks a PNG IHDR');
  let offset = pngSignature.length;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  let width = 0;
  let height = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length)
      throw new Error('Detox cancel screenshot has a truncated PNG chunk');
    const length = bytes.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const end = dataOffset + length + 4;
    if (end > bytes.length) throw new Error('Detox cancel screenshot has an overflowing PNG chunk');
    const type = bytes.toString('ascii', typeOffset, typeOffset + 4);
    if (type === 'IHDR') {
      if (sawIhdr || length !== 13 || offset !== pngSignature.length)
        throw new Error('Detox cancel screenshot has an invalid PNG IHDR');
      sawIhdr = true;
      width = bytes.readUInt32BE(dataOffset);
      height = bytes.readUInt32BE(dataOffset + 4);
    } else if (type === 'IDAT') sawIdat = true;
    else if (type === 'IEND') {
      if (length !== 0 || !sawIhdr || !sawIdat || end !== bytes.length)
        throw new Error('Detox cancel screenshot has an incomplete PNG stream');
      sawIend = true;
      break;
    }
    offset = end;
  }
  if (!sawIend) throw new Error('Detox cancel screenshot lacks a PNG IEND');
  if (!width || !height || width > 8192 || height > 8192)
    throw new Error('Detox cancel screenshot dimensions are invalid');
}

export async function verifyDetoxCancelUiEvidence(
  artifactRoot: string,
  evidence: DetoxCancelUiEvidence,
) {
  const files = [
    ['hierarchyFile', evidence.hierarchyFile, evidence.hierarchySha256, 512 * 1024],
    ['screenshotFile', evidence.screenshotFile, evidence.screenshotSha256, 8 * 1024 * 1024],
  ] as const;
  const output: { name: string; bytes: number; sha256: string }[] = [];
  for (const [label, name, expectedHash, maxBytes] of files) {
    if (!/^[a-z0-9-]+\.private\.(?:xml|png)$/.test(name))
      throw new Error(`Detox ${label} filename is unsafe`);
    const file = path.join(artifactRoot, name);
    if ((await realpath(file)) !== file) throw new Error(`Detox ${label} is not canonical`);
    const metadata = await lstat(file);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.size === 0 ||
      metadata.size > maxBytes
    )
      throw new Error(`Detox ${label} is not an owned private file`);
    const bytes = await readFile(file);
    if (hash(bytes) !== expectedHash) throw new Error(`Detox ${label} hash changed`);
    if (label === 'hierarchyFile') {
      const nodes = parseDetoxHierarchyXml(bytes.toString('utf8'));
      if (
        hasSelector(nodes, 'settings.account.signOutConfirm') ||
        !hasSelector(nodes, 'settings.account.screen')
      )
        throw new Error('Detox cancel hierarchy does not prove modal absence and account presence');
    } else validatePng(bytes);
    output.push({ name, bytes: bytes.byteLength, sha256: expectedHash });
  }
  return output;
}

export function requireCancelEvidenceShape(value: unknown): asserts value is DetoxCancelUiEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Detox cancel UI evidence is missing');
  const row = value as Record<string, unknown>;
  if (row.modalPresent !== false || row.accountScreenPresent !== true)
    throw new Error('Detox cancel UI state is not exact');
  for (const key of ['hierarchyFile', 'hierarchySha256', 'screenshotFile', 'screenshotSha256'])
    if (typeof row[key] !== 'string' || row[key].length === 0)
      throw new Error('Detox cancel UI receipt metadata is incomplete');
}
