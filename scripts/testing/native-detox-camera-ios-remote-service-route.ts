import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  runRemoteServicePromptHelper,
  type RemoteServiceHelperOptions,
  type RemoteServiceHelperResult,
  type RemoteServiceNativeExecutor,
} from './ios-detox-camera-remote-service-helper';
import { executeOwnedNativeCommand } from './owned-native-command';

/**
 * Inputs owned by the already-acquired camera owner. The helper does not
 * acquire a second simulator, proxy, session, or Detox child.
 */
export type DetoxCameraRemoteServiceRouteOptions = Omit<
  RemoteServiceHelperOptions,
  'execute' | 'deadlineAtMonotonicMs'
> & {
  deadlineAtMonotonicMs: number;
  /** The existing camera child has published its protected prompt stage. */
  bootstrapStagePublished: true;
  execute?: RemoteServiceNativeExecutor;
};

/** Static build/receipt paths supplied before the owner selects its UDID. */
export type DetoxCameraRemoteServiceOwnerConfig = Omit<
  DetoxCameraRemoteServiceRouteOptions,
  | 'artifactRoot'
  | 'deviceUdid'
  | 'bootstrapChild'
  | 'bootstrapCommandHash'
  | 'deadlineAtEpochMs'
  | 'deadlineAtMonotonicMs'
  | 'signal'
  | 'bootstrapStagePublished'
>;

const helperEnvironmentPaths = Object.freeze({
  sourceRoot: 'MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_SOURCE_ROOT',
  projectPath: 'MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_PROJECT_PATH',
  xctestrunPath: 'MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_XCTESTRUN_PATH',
  helperBinaryPath: 'MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_BINARY_PATH',
  commandCwd: 'MYCHAMPIONS_IOS_CAMERA_REMOTE_HELPER_COMMAND_CWD',
} as const);

/**
 * Resolve only the static, qualified helper inputs. A partial environment is
 * rejected so a camera run cannot silently omit the prompt probe. Build and
 * xctestrun receipt materialization remains an explicit owner/build step.
 */
export function requireDetoxCameraRemoteServiceOwnerConfig(input: {
  environment: Readonly<Record<string, string | undefined>>;
  artifactRoot: string;
  reviewedSourceRoot: string;
}): DetoxCameraRemoteServiceOwnerConfig {
  const values = Object.fromEntries(
    Object.entries(helperEnvironmentPaths).map(([field, key]) => [field, input.environment[key]]),
  ) as Record<keyof typeof helperEnvironmentPaths, string | undefined>;
  const missing = Object.entries(values)
    .filter(([, value]) => typeof value !== 'string' || value.length === 0)
    .map(([field]) => field);
  if (missing.length > 0)
    throw new Error(`iOS camera remote helper configuration is incomplete: ${missing.join(',')}`);
  if (path.resolve(values.sourceRoot!) !== path.resolve(input.reviewedSourceRoot))
    throw new Error('iOS camera remote helper source root is not the reviewed repository root');
  const artifactRoot = path.resolve(input.artifactRoot);
  return {
    reviewedSourceRoot: path.resolve(input.reviewedSourceRoot),
    sourceRoot: path.resolve(input.reviewedSourceRoot),
    projectPath: values.projectPath!,
    xctestrunPath: values.xctestrunPath!,
    helperBinaryPath: values.helperBinaryPath!,
    commandCwd: values.commandCwd!,
    buildReceiptPath: path.join(artifactRoot, 'ios-remote-service-build.private.json'),
    receiptPath: path.join(artifactRoot, 'ios-remote-service-helper.private.json'),
    commandReceiptPath: path.join(artifactRoot, 'ios-remote-service-command.private.json'),
    cancelPath: path.join(artifactRoot, 'ios-remote-service-cancel.private'),
  };
}

/**
 * Bind the private XCTest prompt probe to the production owned native command
 * executor. This function is called by the current owner after the pending
 * bootstrap IPC response and before the child can publish final readiness or
 * receive a camera-entry IPC request. A missing prompt is a valid helper
 * result; cancellation, deadline, receipt, and cleanup failures remain errors
 * and therefore cannot be swallowed.
 */
export async function runOwnedDetoxCameraRemoteServicePrompt(
  options: DetoxCameraRemoteServiceRouteOptions,
): Promise<RemoteServiceHelperResult> {
  if (options.bootstrapStagePublished !== true)
    throw new Error('Remote service prompt helper requires the pending bootstrap stage');
  if (
    !Number.isSafeInteger(options.bootstrapChild.pid) ||
    options.bootstrapChild.pid <= 1 ||
    !Number.isSafeInteger(options.bootstrapChild.pgid) ||
    options.bootstrapChild.pgid <= 1 ||
    typeof options.bootstrapChild.startedAt !== 'string' ||
    options.bootstrapChild.startedAt.length === 0
  )
    throw new Error('Remote service prompt helper requires the bootstrap child identity');
  if (!/^[a-f0-9]{64}$/.test(options.bootstrapCommandHash))
    throw new Error('Remote service prompt helper requires the pending bootstrap command hash');
  if (options.signal?.aborted) throw new Error('Remote service prompt helper cancelled');
  if (
    !Number.isFinite(options.deadlineAtMonotonicMs) ||
    performance.now() >= options.deadlineAtMonotonicMs
  )
    throw new Error('Remote service prompt helper deadline exceeded before route entry');

  return runRemoteServicePromptHelper({
    ...options,
    // The default is the same owned executor used for Jest and the Detox
    // child. Tests may inject a recorder, but production has one owner.
    execute:
      options.execute ??
      (async (command) => {
        const execution = await executeOwnedNativeCommand(command);
        return { ...execution, phase: 'step' as const };
      }),
  });
}

export const __private = Object.freeze({
  assertRouteEntry(options: Pick<DetoxCameraRemoteServiceRouteOptions, 'bootstrapStagePublished'>) {
    if (options.bootstrapStagePublished !== true)
      throw new Error('Remote service prompt helper route entered before pending bootstrap stage');
  },
});
