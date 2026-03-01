/**
 * React hook for professional invite code and specialty operations.
 * Wraps professional-source for UI consumption.
 * No Firebase/Data Connect concerns in screen components.
 */

import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import {
  getOrCreateActiveInviteCode,
  rotateInviteCode,
  getProfessionalSpecialties,
  addProfessionalSpecialty,
  removeProfessionalSpecialty,
  upsertProfessionalCredential,
} from './professional-source';
import {
  resolveDisplayInviteCode,
  normalizeInviteCodeActionError,
  type InviteCode,
  type DisplayInviteCode,
  type InviteCodeActionErrorReason,
} from './connection-invite.logic';
import {
  checkSpecialtyRemoval,
  normalizeSpecialtyActionError,
  type Specialty,
  type SpecialtyRecord,
  type SpecialtyRemovalResult,
  type SpecialtyActionErrorReason,
} from './specialty.logic';

// ─── State types ──────────────────────────────────────────────────────────────

export type InviteCodeLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; code: InviteCode | null; displayCode: DisplayInviteCode };

export type SpecialtiesLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; specialties: SpecialtyRecord[] };

// ─── Invite code hook ─────────────────────────────────────────────────────────

export type UseInviteCodeResult = {
  state: InviteCodeLoadState;
  reload: () => void;
  rotate: () => Promise<InviteCodeActionErrorReason | null>;
};

export function useInviteCode(user: User | null): UseInviteCodeResult {
  const [state, setState] = useState<InviteCodeLoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!user) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'loading' });

    void getOrCreateActiveInviteCode(user)
      .then((code) => {
        setState({ kind: 'ready', code, displayCode: resolveDisplayInviteCode(code) });
      })
      .catch((err: Error) => {
        setState({ kind: 'error', message: err.message });
      });
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const rotate = useCallback(async (): Promise<InviteCodeActionErrorReason | null> => {
    if (!user) return 'configuration';

    try {
      await rotateInviteCode(user);
      load();
      return null;
    } catch (err) {
      return normalizeInviteCodeActionError(err);
    }
  }, [user, load]);

  return { state, reload: load, rotate };
}

// ─── Specialties hook ─────────────────────────────────────────────────────────

export type UseSpecialtiesResult = {
  state: SpecialtiesLoadState;
  reload: () => void;
  checkRemoval: (
    specialty: Specialty,
    activeCount: number,
    pendingCount: number
  ) => SpecialtyRemovalResult;
  addSpecialty: (specialty: Specialty) => Promise<SpecialtyActionErrorReason | null>;
  removeSpecialty: (specialty: Specialty) => Promise<SpecialtyActionErrorReason | null>;
  upsertCredential: (
    specialty: Specialty,
    input: { registryId: string; authority: string; country: string }
  ) => Promise<SpecialtyActionErrorReason | null>;
};

export function useSpecialties(user: User | null): UseSpecialtiesResult {
  const [state, setState] = useState<SpecialtiesLoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!user) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'loading' });

    void getProfessionalSpecialties(user)
      .then((specialties) => {
        setState({ kind: 'ready', specialties });
      })
      .catch((err: Error) => {
        setState({ kind: 'error', message: err.message });
      });
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const checkRemoval = useCallback(
    (
      specialty: Specialty,
      activeCount: number,
      pendingCount: number
    ): SpecialtyRemovalResult => {
      const totalActive =
        state.kind === 'ready'
          ? state.specialties.filter((s) => s.isActive).length
          : 0;

      return checkSpecialtyRemoval({
        specialtyToRemove: specialty,
        activeStudentCountForSpecialty: activeCount,
        pendingStudentCountForSpecialty: pendingCount,
        totalActiveSpecialtyCount: totalActive,
      });
    },
    [state]
  );

  const addSpecialty = useCallback(
    async (specialty: Specialty): Promise<SpecialtyActionErrorReason | null> => {
      if (!user) return 'unknown';

      try {
        await addProfessionalSpecialty(user, specialty);
        load();
        return null;
      } catch (err) {
        return normalizeSpecialtyActionError(err);
      }
    },
    [user, load]
  );

  const removeSpecialty = useCallback(
    async (specialty: Specialty): Promise<SpecialtyActionErrorReason | null> => {
      if (!user) return 'unknown';

      try {
        await removeProfessionalSpecialty(user, specialty);
        load();
        return null;
      } catch (err) {
        return normalizeSpecialtyActionError(err);
      }
    },
    [user, load]
  );

  const upsertCredential = useCallback(
    async (
      specialty: Specialty,
      input: { registryId: string; authority: string; country: string }
    ): Promise<SpecialtyActionErrorReason | null> => {
      if (!user) return 'unknown';

      try {
        await upsertProfessionalCredential(user, specialty, input);
        load();
        return null;
      } catch (err) {
        return normalizeSpecialtyActionError(err);
      }
    },
    [user, load]
  );

  return {
    state,
    reload: load,
    checkRemoval,
    addSpecialty,
    removeSpecialty,
    upsertCredential,
  };
}
