import sharp from 'sharp';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type VisualRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisualEvidenceVerdict = 'pass' | 'fail' | 'unbaselined';

export type VisualEvidenceMetadata = {
  schemaVersion: 1;
  checkpoint: string;
  verdict: VisualEvidenceVerdict;
  baselinePath: string | null;
  actualPath: string;
  diffPath: string | null;
  sideBySidePath: string | null;
  diffPercentage: number | null;
  boundingBox: VisualRect | null;
  ignoreRects: VisualRect[];
  dimensions: { width: number; height: number } | null;
  reason?: string;
};

type RawImage = {
  data: Buffer;
  width: number;
  height: number;
};

type CompareOptions = {
  checkpoint: string;
  baselinePath?: string | null;
  actualPath: string;
  diffPath?: string | null;
  sideBySidePath?: string | null;
  ignoreRects?: readonly VisualRect[];
};

const EMPTY_DIFF_COLOR = { r: 0, g: 0, b: 0, alpha: 0 };
const DIFF_COLOR = { r: 220, g: 38, b: 38, alpha: 1 };

async function readRawImage(imagePath: string): Promise<RawImage> {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function isInsideRect(x: number, y: number, rect: VisualRect): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

function isIgnored(x: number, y: number, ignoreRects: readonly VisualRect[]): boolean {
  return ignoreRects.some((rect) => isInsideRect(x, y, rect));
}

function boundingBoxForDiffs(
  width: number,
  height: number,
  baseline: RawImage,
  actual: RawImage,
  ignoreRects: readonly VisualRect[],
): { box: VisualRect | null; diffPixels: number; diffData: Buffer } {
  const diffData = Buffer.alloc(width * height * 4);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let diffPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = (y * width + x) * 4;
      const ignored = isIgnored(x, y, ignoreRects);
      const differs =
        baseline.data[pixelOffset] !== actual.data[pixelOffset] ||
        baseline.data[pixelOffset + 1] !== actual.data[pixelOffset + 1] ||
        baseline.data[pixelOffset + 2] !== actual.data[pixelOffset + 2] ||
        baseline.data[pixelOffset + 3] !== actual.data[pixelOffset + 3];

      if (differs && !ignored) {
        diffPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        diffData[pixelOffset] = DIFF_COLOR.r;
        diffData[pixelOffset + 1] = DIFF_COLOR.g;
        diffData[pixelOffset + 2] = DIFF_COLOR.b;
        diffData[pixelOffset + 3] = 255;
      } else {
        diffData[pixelOffset] = EMPTY_DIFF_COLOR.r;
        diffData[pixelOffset + 1] = EMPTY_DIFF_COLOR.g;
        diffData[pixelOffset + 2] = EMPTY_DIFF_COLOR.b;
        diffData[pixelOffset + 3] = EMPTY_DIFF_COLOR.alpha;
      }
    }
  }

  return {
    box: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    diffPixels,
    diffData,
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeSideBySide(
  baselinePath: string,
  actualPath: string,
  outputPath: string,
  width: number,
  height: number,
): Promise<void> {
  const [baseline, actual] = await Promise.all([
    sharp(baselinePath).ensureAlpha().png().toBuffer(),
    sharp(actualPath).ensureAlpha().png().toBuffer(),
  ]);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({
    create: {
      width: width * 2,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: baseline, left: 0, top: 0 },
      { input: actual, left: width, top: 0 },
    ])
    .png()
    .toFile(outputPath);
}

export async function compareVisualEvidence(
  options: CompareOptions,
): Promise<VisualEvidenceMetadata> {
  const ignoreRects = [...(options.ignoreRects ?? [])];
  const baselinePath = options.baselinePath ?? null;
  const actualPath = options.actualPath;

  if (!baselinePath || !(await exists(baselinePath))) {
    return {
      schemaVersion: 1,
      checkpoint: options.checkpoint,
      verdict: 'unbaselined',
      baselinePath,
      actualPath,
      diffPath: null,
      sideBySidePath: null,
      diffPercentage: null,
      boundingBox: null,
      ignoreRects,
      dimensions: null,
      reason: baselinePath ? 'baseline_not_found' : 'baseline_not_configured',
    };
  }

  const [baseline, actual] = await Promise.all([
    readRawImage(baselinePath),
    readRawImage(actualPath),
  ]);

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      schemaVersion: 1,
      checkpoint: options.checkpoint,
      verdict: 'fail',
      baselinePath,
      actualPath,
      diffPath: null,
      sideBySidePath: null,
      diffPercentage: 100,
      boundingBox: {
        x: 0,
        y: 0,
        width: Math.max(baseline.width, actual.width),
        height: Math.max(baseline.height, actual.height),
      },
      ignoreRects,
      dimensions: { width: actual.width, height: actual.height },
      reason: `dimension_mismatch:${baseline.width}x${baseline.height}!=${actual.width}x${actual.height}`,
    };
  }

  const { box, diffPixels, diffData } = boundingBoxForDiffs(
    actual.width,
    actual.height,
    baseline,
    actual,
    ignoreRects,
  );
  const diffPercentage = (diffPixels / (actual.width * actual.height)) * 100;

  if (options.diffPath) {
    await mkdir(path.dirname(options.diffPath), { recursive: true });
    await sharp(diffData, {
      raw: { width: actual.width, height: actual.height, channels: 4 },
    })
      .png()
      .toFile(options.diffPath);
  }

  if (options.sideBySidePath) {
    await writeSideBySide(
      baselinePath,
      actualPath,
      options.sideBySidePath,
      actual.width,
      actual.height,
    );
  }

  return {
    schemaVersion: 1,
    checkpoint: options.checkpoint,
    verdict: box ? 'fail' : 'pass',
    baselinePath,
    actualPath,
    diffPath: options.diffPath ?? null,
    sideBySidePath: options.sideBySidePath ?? null,
    diffPercentage: Number(diffPercentage.toFixed(4)),
    boundingBox: box,
    ignoreRects,
    dimensions: { width: actual.width, height: actual.height },
  };
}

export async function writeVisualEvidenceMetadata(
  metadataPath: string,
  metadata: VisualEvidenceMetadata,
): Promise<void> {
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function parseIgnoreRects(checkpoint: string): VisualRect[] {
  const raw = process.env.WEB_E2E_VISUAL_IGNORE_RECTS;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)[checkpoint]
        : undefined;
    if (!Array.isArray(values)) return [];

    return values.filter((value): value is VisualRect => {
      if (!value || typeof value !== 'object') return false;
      const rect = value as Record<string, unknown>;
      return ['x', 'y', 'width', 'height'].every(
        (key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]),
      );
    });
  } catch {
    return [];
  }
}

export async function captureVisualEvidenceMetadata(
  actualPath: string,
  checkpoint: string,
  baselineSegments: readonly string[],
): Promise<string> {
  const baselineRoot = process.env.WEB_E2E_VISUAL_BASELINE_ROOT;
  const baselinePath = baselineRoot
    ? path.join(path.resolve(baselineRoot), ...baselineSegments)
    : null;
  const diffPath = baselinePath ? actualPath.replace(/\.png$/i, '.diff.png') : null;
  const sideBySidePath = baselinePath ? actualPath.replace(/\.png$/i, '.side-by-side.png') : null;
  const metadataPath = actualPath.replace(/\.png$/i, '.json');
  const metadata = await compareVisualEvidence({
    checkpoint,
    baselinePath,
    actualPath,
    diffPath,
    sideBySidePath,
    ignoreRects: parseIgnoreRects(checkpoint),
  });
  await writeVisualEvidenceMetadata(metadataPath, metadata);
  return metadataPath;
}
