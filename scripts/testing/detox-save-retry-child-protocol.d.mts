export declare const DETOX_SAVE_RETRY_PROTOCOL_SCHEMA: 1;
export declare const DETOX_SAVE_RETRY_COMMANDS: readonly [
  'prepare-draft',
  'failed-save',
  'retry-save',
  'reopen',
  'shutdown',
];
export declare const DETOX_SAVE_RETRY_DRAFT: Readonly<{
  title: 'Native QA Draft';
  sessionName: 'Strength';
  exerciseId: '00000000-0000-4000-8000-000000000001';
  exerciseName: 'en QA Exercise 1';
  quantity: '3x8';
  notes: '';
}>;
export type DetoxSaveRetryPlatform = 'ios' | 'android';
export type DetoxSaveRetryCommandKind = (typeof DETOX_SAVE_RETRY_COMMANDS)[number];
export declare function selectorsForDetoxSaveRetryCommand(
  commandKind: DetoxSaveRetryCommandKind,
  planId?: string,
  errorText?: string,
): string[];
export type DetoxSaveRetryCommand = Readonly<Record<string, unknown>> & {
  schemaVersion: 1;
  kind: 'private-detox-save-retry-command';
  commandId: number;
  runId: string;
  attemptId: string;
  platform: DetoxSaveRetryPlatform;
  commandKind: DetoxSaveRetryCommandKind;
  commandHash: string;
  selectors?: readonly string[];
  draft?: typeof DETOX_SAVE_RETRY_DRAFT;
  errorText?: string;
  planId?: string;
};
export declare function canonical(value: unknown): string;
export declare function hashJson(value: unknown): string;
export declare function assertDetoxSaveRetryCommand(value: unknown): DetoxSaveRetryCommand;
export declare function buildDetoxSaveRetryCommand(input: {
  commandId: number;
  runId: string;
  attemptId: string;
  platform: DetoxSaveRetryPlatform;
  commandKind: DetoxSaveRetryCommandKind;
  errorText?: string;
  planId?: string;
}): DetoxSaveRetryCommand;
export declare function assertDetoxSaveRetryResponse(
  value: unknown,
  command: DetoxSaveRetryCommand,
  expectedChild?: { pid: number; pgid: number; started: string },
  deadlineAt?: number,
): Record<string, unknown>;
