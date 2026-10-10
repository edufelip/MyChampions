/**
 * Support hook for UI consumption.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { submitSupportMessage } from './support-source';
import { createSupportSubmissionGate } from './support-submission-gate';
import {
  validateSupportInput,
  normalizeSupportError,
  type SupportMessageInput,
  type SupportErrorReason,
} from './support.logic';

export type SupportState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'cooldown'; retryAfterSeconds: number }
  | { kind: 'error'; reason: SupportErrorReason };

function supportSubmissionFingerprint(input: SupportMessageInput & { userRole?: string | null }) {
  return `${input.subject}\u0000${input.body}\u0000${input.userRole ?? ''}`;
}

function createSupportIdempotencyKey() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `support-${uuid}`;

  return `support-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useSupport() {
  const [state, setState] = useState<SupportState>({ kind: 'idle' });
  const submissionGate = useRef(createSupportSubmissionGate());
  const cooldownUntil = useRef<number | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousSubmission = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const clearCooldownTimer = useCallback(() => {
    if (cooldownTimer.current) {
      clearInterval(cooldownTimer.current);
      cooldownTimer.current = null;
    }
  }, []);

  const startCooldown = useCallback(
    (retryAfterSeconds?: number) => {
      const seconds = Math.max(1, retryAfterSeconds ?? 1);
      cooldownUntil.current = Date.now() + seconds * 1_000;
      setState({ kind: 'cooldown', retryAfterSeconds: seconds });
      clearCooldownTimer();
      cooldownTimer.current = setInterval(() => {
        const remainingSeconds = Math.max(
          0,
          Math.ceil(((cooldownUntil.current ?? 0) - Date.now()) / 1_000),
        );
        if (remainingSeconds === 0) {
          clearCooldownTimer();
          cooldownUntil.current = null;
          setState({ kind: 'idle' });
          return;
        }
        setState({ kind: 'cooldown', retryAfterSeconds: remainingSeconds });
      }, 1_000);
    },
    [clearCooldownTimer],
  );

  useEffect(
    () => () => {
      clearCooldownTimer();
    },
    [clearCooldownTimer],
  );

  const submit = useCallback(
    async (input: SupportMessageInput & { userRole?: string | null }) => {
      if ((cooldownUntil.current ?? 0) > Date.now()) return;

      const validationError = validateSupportInput(input);
      if (validationError) {
        setState({ kind: 'error', reason: validationError });
        return;
      }

      if (!submissionGate.current.tryAcquire()) return;

      const fingerprint = supportSubmissionFingerprint(input);
      const idempotencyKey =
        previousSubmission.current?.fingerprint === fingerprint
          ? previousSubmission.current.idempotencyKey
          : createSupportIdempotencyKey();
      previousSubmission.current = { fingerprint, idempotencyKey };
      setState({ kind: 'submitting' });
      try {
        await submitSupportMessage({ ...input, idempotencyKey });
        previousSubmission.current = null;
        setState({ kind: 'success' });
      } catch (error) {
        if (normalizeSupportError(error) === 'rate_limited') {
          startCooldown(
            error instanceof Error && 'retryAfterSeconds' in error
              ? (error as { retryAfterSeconds?: number }).retryAfterSeconds
              : undefined,
          );
          return;
        }
        setState({ kind: 'error', reason: normalizeSupportError(error) });
      } finally {
        submissionGate.current.release();
      }
    },
    [startCooldown],
  );

  const reset = useCallback(() => {
    clearCooldownTimer();
    cooldownUntil.current = null;
    previousSubmission.current = null;
    setState({ kind: 'idle' });
  }, [clearCooldownTimer]);

  return {
    state,
    submit,
    reset,
  };
}
