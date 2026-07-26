import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app');

describe('responsive web screen structure', () => {
  it('requires every DsScreen route to declare an intentional content width', () => {
    const files = globSync('**/*.tsx', { cwd: appRoot });
    const missing: string[] = [];

    for (const file of files) {
      const source = readFileSync(path.join(appRoot, file), 'utf8');
      for (const match of source.matchAll(/<DsScreen\b[\s\S]*?>/g)) {
        if (!/\bcontentWidth=(?:"(?:form|content|wide|full)"|\{)/.test(match[0])) {
          missing.push(file);
        }
      }
    }

    assert.deepEqual(missing, []);
  });

  it('does not hide document-level horizontal overflow', () => {
    const html = readFileSync(path.join(appRoot, '+html.tsx'), 'utf8');
    assert.doesNotMatch(html, /overflow-x\s*:\s*hidden/);
  });
});
