/**
 * Support hook for UI consumption.
 */

import { useCallback, useState } from 'react';
import {
  validateSupportInput,
  normalizeSupportError,
  type SupportMessageInput,
  type SupportErrorReason,
} from './support.logic';
import { submitSupportMessage } from './support-source';

export type SupportState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; reason: SupportErrorReason };

export function useSupport() {
  const [state, setState] = useState<SupportState>({ kind: 'idle' });

  const submit = useCallback(async (input: SupportMessageInput & { userRole?: string | null }) => {
    const validationError = validateSupportInput(input);
    if (validationError) {
      setState({ kind: 'error', reason: validationError });
      return;
    }

    setState({ kind: 'submitting' });
    try {
      await submitSupportMessage(input);
      setState({ kind: 'success' });
    } catch (error) {
      setState({ kind: 'error', reason: normalizeSupportError(error) });
    }
  }, []);

  const reset = useCallback(() => {
    setState({ kind: 'idle' });
  }, []);

  return {
    state,
    submit,
    reset,
  };
}
