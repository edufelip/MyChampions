/**
 * Run one command against a freshly started, prewarmed Metro, then stop Metro.
 * The fixture env (EXPO_PUBLIC_E2E_*) comes from the caller's environment and
 * is baked into the bundle when Metro starts. Reuses the selective CI executor
 * so local runs and CI share the same Metro ownership and cleanup.
 *
 *   node --import tsx scripts/testing/run-with-fresh-metro.ts \
 *     --platform ios|android [--port 8081] -- COMMAND [ARGS...]
 */
import { resolve } from 'node:path';
import { installCancellationHandlers, runInvocations } from '../ci/execute-selected-tests';
import { parseNativeMetroPort } from '../ci/selective-execution';

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const platform = valueAfter('--platform');
  if (platform !== 'ios' && platform !== 'android') {
    throw new Error('--platform ios|android is required');
  }
  const separator = process.argv.indexOf('--');
  const [command, ...args] = separator === -1 ? [] : process.argv.slice(separator + 1);
  if (!command) throw new Error('a command is required after --');
  const port = parseNativeMetroPort(
    platform,
    valueAfter('--port') ?? process.env.NATIVE_METRO_PORT,
  );
  await runInvocations(
    [
      {
        id: `fresh-metro-${platform}`,
        command,
        args,
        env: {},
        metro: { port, platform, appId: 'com.edufelip.mychampions.dev' },
      },
    ],
    resolve(process.cwd()),
    undefined,
  );
}

installCancellationHandlers();
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
