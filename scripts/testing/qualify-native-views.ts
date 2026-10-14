import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  nativeViewFingerprint,
  nativeAuxiliaryEvidencePaths,
  readNativeEvidence,
  validateNativeViewReceipt,
} from './native-view-evidence';
import type {
  NativeViewDeclaration,
  NativeViewReceipt,
  ViewEvidence,
} from './native-view-evidence';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !/^--run-id=[a-f0-9]{24}$/.test(args[0]))
    throw new Error('Expected exactly --run-id=<24-character-capture-id>');
  const runId = args[0].slice('--run-id='.length);
  const root = path.resolve(__dirname, '../..');
  const artifactRoot = `.qa/artifacts/native-pilot/${runId}`;
  const output = path.join(root, artifactRoot);
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const captureBytes = readNativeEvidence(output, 'capture.private.json', true);
  const cleanupBytes = readNativeEvidence(output, 'external-cleanup.private.json', true);
  const capture = JSON.parse(captureBytes.toString()) as {
    finishedAt: string;
    platform: 'ios' | 'android';
    charter: string;
    source: { sha: string };
    build: { binaryHash: string };
    device: { udid: string; serial: string };
    backend: { runId: string };
  };
  const declaration = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as NativeViewDeclaration & {
    run: Record<string, unknown>;
    views: { id: string; sourceRefs: string[]; receiptIds: string[]; captureStatus: string }[];
    receipts: unknown[];
  };
  const viewEvidence = JSON.parse(
    readNativeEvidence(output, 'reviewed-views.private.json', true).toString(),
  ) as ViewEvidence[];
  const auxiliaryPaths = nativeAuxiliaryEvidencePaths(capture.platform, capture.charter);
  const receipt: NativeViewReceipt & {
    scenarioIds: string[];
    target: string;
    command: string;
    scope: string;
    nativePassingCases: number;
  } = {
    id: `REC-native-views-${runId}`,
    timestamp: capture.finishedAt,
    commit: capture.source.sha,
    result: 'observed',
    platform: capture.platform,
    build: capture.build.binaryHash,
    device: capture.platform === 'ios' ? capture.device.udid : capture.device.serial,
    fixtureRef: `owned-postgres:native-entry-${capture.platform}:${capture.backend.runId}`,
    target: 'com.edufelip.mychampions.dev; Metro-attached Debug; view observation only',
    command: `node --import tsx scripts/testing/qualify-native-views.ts --run-id=${runId}`,
    scope: `view-observation-only; ${capture.platform}; no transition or behavioral qualification`,
    nativePassingCases: 0,
    scenarioIds: [
      'training-draft',
      'training-discard',
      'training-load',
      'training-journey',
      'save-retry',
    ].includes(capture.charter)
      ? [
          `SCN-session-${capture.platform}`,
          `SCN-training-${capture.platform}`,
          ...(capture.charter === 'save-retry' ? [`SCN-save-retry-${capture.platform}`] : []),
        ]
      : capture.charter === 'connection-states'
        ? [`SCN-session-${capture.platform}`, `SCN-connection-${capture.platform}`]
        : capture.charter === 'camera-denied'
          ? [`SCN-camera-denied-${capture.platform}`]
          : [`SCN-session-${capture.platform}`],
    artifactRoot,
    captureHash: hash(captureBytes),
    cleanupHash: hash(cleanupBytes),
    viewEvidence,
    auxiliaryEvidence: auxiliaryPaths.map((relative) => ({
      path: relative,
      sha256: hash(readNativeEvidence(output, relative, !relative.endsWith('.png'))),
    })),
    evidencePaths: [
      'capture.private.json',
      'external-cleanup.private.json',
      'bootstrap.private.log',
      ...auxiliaryPaths.filter((name) => name !== 'bootstrap.private.log'),
      ...viewEvidence.flatMap((row) => [row.screenshotPath, row.hierarchyPath]),
    ],
    inputFingerprint: '',
  };
  receipt.inputFingerprint = nativeViewFingerprint(receipt, declaration);
  const capturedViews = await validateNativeViewReceipt(receipt, root, declaration);
  const runtime = structuredClone(declaration);
  runtime.run = {
    ...runtime.run,
    id: runId,
    updatedAt: capture.finishedAt,
    build: receipt.build,
    device: receipt.device,
    target: receipt.target,
  };
  runtime.receipts.push(receipt);
  for (const view of runtime.views) {
    if (capturedViews.includes(view.id)) {
      view.captureStatus = 'runtime-captured';
      view.receiptIds.push(receipt.id);
    }
  }
  const { validateNativeInventory } = await import('./validate-native-inventory.mjs');
  const metrics = await validateNativeInventory(runtime, root);
  const suffix = receipt.inputFingerprint.slice(0, 12);
  await writeFile(
    path.join(output, `qualified-views-${suffix}.private.json`),
    JSON.stringify(receipt, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(
    path.join(output, `inventory-observed-${suffix}.private.json`),
    JSON.stringify(runtime, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(
    path.join(output, `view-metrics-${suffix}.private.json`),
    JSON.stringify(metrics, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  process.stdout.write(
    `Qualified ${capturedViews.length} ${capture.platform} views; zero transition/behavior passes; private suffix ${suffix}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Native view qualification blocked: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 2;
});
