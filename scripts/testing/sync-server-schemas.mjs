import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = path.resolve(clientRoot, '../server/scripts/testing/schemas');
const destination = path.join(clientRoot, 'scripts/testing/schemas');
const check = process.argv.slice(2).length === 1 && process.argv[2] === '--check';
if (process.argv.length > 3 || (process.argv[2] && !check))
  throw new Error('Usage: sync-server-schemas.mjs [--check]');
const copies = [];
for (const name of (await readdir(source)).filter((name) => name.endsWith('.schema.json')).sort()) {
  const bytes = await readFile(path.join(source, name));
  copies.push({
    path: name,
    source: `server/scripts/testing/schemas/${name}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  if (check) {
    if (!bytes.equals(await readFile(path.join(destination, name))))
      throw new Error('Vendored server schema is stale');
  } else await writeFile(path.join(destination, name), bytes);
}
const provenance = `${JSON.stringify({ schemaVersion: 1, canonicalOwner: 'server', copies }, null, 2)}\n`;
const provenancePath = path.join(destination, 'server-schema-provenance.json');
if (check) {
  if (provenance !== (await readFile(provenancePath, 'utf8')))
    throw new Error('Schema provenance is stale');
} else await writeFile(provenancePath, provenance);
console.log(`${check ? 'Checked' : 'Synced'} ${copies.length} server-owned schemas`);
