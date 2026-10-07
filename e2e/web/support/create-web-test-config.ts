import path from 'node:path';
import { defineConfig, type ReporterDescription } from '@playwright/test';
import { getWebTestProfile, type WebTestProfileName } from './test-profiles';

/** Shared artifact setup; each profile retains its own app/data/browser state. */
export function createWebTestConfig(name: WebTestProfileName) {
  const { artifactRoot, reportFiles, config } = getWebTestProfile(name);
  const reporter: ReporterDescription[] = reportFiles.reporters.map((kind) => {
    switch (kind) {
      case 'html':
        return [
          'html',
          { outputFolder: path.join(artifactRoot, reportFiles.htmlDirName!), open: 'never' },
        ];
      case 'json':
        return ['json', { outputFile: path.join(artifactRoot, reportFiles.jsonFileName!) }];
      case 'junit':
        return ['junit', { outputFile: path.join(artifactRoot, reportFiles.junitFileName!) }];
      case 'list':
        return ['list'];
    }
  });
  return defineConfig({
    ...config,
    outputDir: path.join(artifactRoot, reportFiles.outputDirName),
    reporter,
  });
}
