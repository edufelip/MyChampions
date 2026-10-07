export type AndroidColdResetBoundary = Readonly<{
  resetStartedAt: string;
  runInstall<T>(execute: () => Promise<T>): Promise<T>;
  runReset<T>(execute: (resetStartedAt: string) => Promise<T>): Promise<T>;
}>;

/**
 * Bind the reset timestamp to the owned install/reset boundary. The owner must
 * complete its owned install command before the real reset producer can run;
 * this keeps a test double from making a reset receipt look like a completed
 * install.
 */
export function createAndroidColdResetBoundary(input: {
  targetOsVersion: string | null;
  resetStartedAt: string;
}): AndroidColdResetBoundary {
  if (!input.targetOsVersion)
    throw new Error('Android Detox camera cold reset target OS identity is unavailable');
  if (
    typeof input.resetStartedAt !== 'string' ||
    !input.resetStartedAt ||
    !Number.isFinite(Date.parse(input.resetStartedAt))
  )
    throw new Error('Android Detox camera cold reset start timestamp is invalid');

  let installCompleted = false;
  return {
    resetStartedAt: input.resetStartedAt,
    async runInstall(execute) {
      if (installCompleted)
        throw new Error('Android Detox camera cold reset install already completed');
      const result = await execute();
      installCompleted = true;
      return result;
    },
    async runReset(execute) {
      if (!installCompleted)
        throw new Error('Android Detox camera cold reset install was not completed');
      return execute(input.resetStartedAt);
    },
  };
}
