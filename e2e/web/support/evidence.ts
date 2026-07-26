import type { Page, TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function captureEvidence(
  page: Page,
  testInfo: TestInfo,
  checkpoint: string
): Promise<string> {
  // Let the product's documented 150-250 ms navigation/state transitions settle
  // so evidence captures the resting UI rather than an in-flight opacity frame.
  await page.waitForTimeout(250);
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });

  const artifactRoot = path.resolve(
    process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/current'
  );
  const projectName = safeSegment(testInfo.project.name);
  const screenshotName = `${safeSegment(checkpoint)}.png`;
  const screenshotDir = path.join(artifactRoot, 'screenshots', projectName);
  const screenshotPath = path.join(screenshotDir, screenshotName);

  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
  await testInfo.attach(checkpoint, { path: screenshotPath, contentType: 'image/png' });

  return screenshotPath;
}

export async function captureFlowEvidence(
  page: Page,
  testInfo: TestInfo,
  flow: string,
  checkpoint: string
): Promise<string> {
  await page.waitForTimeout(250);
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });

  const artifactRoot = path.resolve(
    process.env.WEB_E2E_ARTIFACT_ROOT ?? '.artifacts/web-e2e/flow-atlas'
  );
  const platform = safeSegment(testInfo.project.name);
  const screenshotName = `${safeSegment(checkpoint)}.png`;
  const screenshotDir = path.join(artifactRoot, 'screenshots', safeSegment(flow), platform);
  const screenshotPath = path.join(screenshotDir, screenshotName);

  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
  await testInfo.attach(`${flow}: ${checkpoint}`, {
    path: screenshotPath,
    contentType: 'image/png',
  });

  return screenshotPath;
}
