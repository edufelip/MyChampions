import type { Stats } from 'node:fs';

export type TrainingChildIdentity = Readonly<{ pid: number; pgid: number; started: string }>;
export type TrainingCommand = Readonly<{
  schemaVersion: 1;
  kind: 'private-detox-training-command';
  commandId: number;
  runId: string;
  attemptId: string;
  platform: 'ios' | 'android';
  timeoutMs: number;
  commandKind: 'training-step' | 'restart-app' | 'shutdown';
  step?: unknown;
  appIdentifier?: string;
  launchCount?: number;
  commandHash: string;
}>;
export type TrainingResponse = Readonly<{
  schemaVersion: 1;
  kind: 'private-detox-training-response';
  commandId: number;
  commandHash: string;
  commandKind: TrainingCommand['commandKind'];
  runId: string;
  attemptId: string;
  platform: TrainingCommand['platform'];
  status: 'completed' | 'failed' | 'cancelled';
  childIdentity: TrainingChildIdentity;
  startedMonotonicMs: number;
  finishedMonotonicMs: number;
  stepReceipt?: unknown;
  restartReceipt?: unknown;
  error?: { name: string; message: string };
}>;
export const TRAINING_PROTOCOL_SCHEMA: 1;
export const MAX_COMMAND_BYTES: number;
export const MAX_RESPONSE_BYTES: number;
export const MAX_XML_BYTES: number;
export const MAX_SCREENSHOT_BYTES: number;
export const MAX_ATTRIBUTES_BYTES: number;
export function canonical(value: unknown): string;
export function hashJson(value: unknown): string;
export function hashBytes(value: Uint8Array): string;
export function assertTrainingCommand(value: unknown): TrainingCommand;
export function assertTrainingResponse(
  value: unknown,
  command: TrainingCommand,
  expectedChild?: TrainingChildIdentity,
  deadlineAt?: number,
): TrainingResponse;
export function evidenceFileName(name: string): string;
export function readOwnedTrainingFile(
  root: string,
  name: string,
  maxBytes: number,
  options?: { signal?: AbortSignal; deadlineAt?: number },
): Promise<Buffer>;
export function readOwnedTrainingPath(
  file: string,
  maxBytes: number,
  options?: { signal?: AbortSignal; deadlineAt?: number; privateRecord?: boolean },
): Promise<{ bytes: Buffer; metadata: Stats; realpath: string }>;
export type TrainingAtomicPublicationOptions = Readonly<{
  signal?: AbortSignal;
  deadlineAt?: number;
  beforePublish?: (paths: { temporary: string; final: string }) => void | Promise<void>;
  afterPublish?: (paths: { temporary: string; final: string }) => void | Promise<void>;
  afterTemporaryUnlink?: (paths: { temporary: string; final: string }) => void | Promise<void>;
}>;
export class TrainingPublicationRecoveryError extends Error {
  readonly code: 'TRAINING_PUBLICATION_RECOVERY';
  readonly details: Readonly<Record<string, unknown>>;
}
export function writeAtomicTrainingJson(
  root: string,
  name: string,
  value: unknown,
  options?: TrainingAtomicPublicationOptions,
): Promise<void>;
export function writeAtomicTrainingBytes(
  root: string,
  name: string,
  bytes: Uint8Array,
  maxBytes: number,
  options?: TrainingAtomicPublicationOptions,
): Promise<void>;
export function publishTrainingCancellation(
  root: string,
  command: TrainingCommand,
  options?: { signal?: AbortSignal; deadlineAt?: number },
): Promise<void>;
export function waitForTrainingCommand(input: {
  root: string;
  afterCommandId?: number;
  signal?: AbortSignal;
  deadlineAt: number;
}): Promise<TrainingCommand>;
export function publishTrainingResponse(
  root: string,
  response: TrainingResponse,
  options?: { signal?: AbortSignal; deadlineAt?: number },
): Promise<void>;
