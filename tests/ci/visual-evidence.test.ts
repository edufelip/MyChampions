import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { compareVisualEvidence } from '../../e2e/web/support/visual-evidence';

const width = 16;
const height = 12;

async function createFixtureImage(path: string, x: number): Promise<void> {
  const data = Buffer.alloc(width * height * 4, 255);
  for (let y = 3; y < 8; y += 1) {
    for (let column = x; column < x + 4; column += 1) {
      const offset = (y * width + column) * 4;
      data[offset] = 30;
      data[offset + 1] = 120;
      data[offset + 2] = 70;
      data[offset + 3] = 255;
    }
  }
  await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(path);
}

test('a deliberate two-pixel visual shift fails with a bounded diff box', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mychampions-visual-'));
  try {
    const baselinePath = join(directory, 'baseline.png');
    const actualPath = join(directory, 'actual.png');
    const diffPath = join(directory, 'diff.png');
    const sideBySidePath = join(directory, 'side-by-side.png');
    await createFixtureImage(baselinePath, 3);
    await createFixtureImage(actualPath, 5);

    const metadata = await compareVisualEvidence({
      checkpoint: 'two-pixel-shift',
      baselinePath,
      actualPath,
      diffPath,
      sideBySidePath,
    });

    assert.equal(metadata.verdict, 'fail');
    assert.ok((metadata.diffPercentage ?? 0) > 0);
    assert.deepEqual(metadata.boundingBox, { x: 3, y: 3, width: 6, height: 5 });
    assert.ok(metadata.diffPath);
    assert.ok(metadata.sideBySidePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an intentionally masked visual region passes and reports the mask', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mychampions-visual-'));
  try {
    const baselinePath = join(directory, 'baseline.png');
    const actualPath = join(directory, 'actual.png');
    await createFixtureImage(baselinePath, 3);
    await createFixtureImage(actualPath, 5);

    const ignoreRects = [{ x: 2, y: 2, width: 8, height: 7 }];
    const metadata = await compareVisualEvidence({
      checkpoint: 'masked-shift',
      baselinePath,
      actualPath,
      ignoreRects,
    });

    assert.equal(metadata.verdict, 'pass');
    assert.equal(metadata.diffPercentage, 0);
    assert.equal(metadata.boundingBox, null);
    assert.deepEqual(metadata.ignoreRects, ignoreRects);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
