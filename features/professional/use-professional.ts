/**
 * React hook for professional invite code and specialty operations.
 * Wraps professional-source for UI consumption.
 * No Firebase/Firestore concerns in screen components.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  getOrCreateActiveInviteCode,
  rotateInviteCode,
  getProfessionalSpecialties,
  getSpecialtyBlockerCounts,
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

export function useInviteCode(isAuthenticated: boolean): UseInviteCodeResult {
  const [state, setState] = useState<InviteCodeLoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!isAuthenticated) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'loading' });

    void getOrCreateActiveInviteCode()
      .then((code) => {
        setState({ kind: 'ready', code, displayCode: resolveDisplayInviteCode(code) });
      })
      .catch((err: Error) => {
        setState({ kind: 'error', message: err.message });
      });
  }, [isAuthenticated]);

  useEffect(() => {
    load();
  }, [load]);

  const rotate = useCallback(async (): Promise<InviteCodeActionErrorReason | null> => {
    if (!isAuthenticated) return 'configuration';

    try {
      await rotateInviteCode();
      load();
      return null;
    } catch (err) {
      return normalizeInviteCodeActionError(err);
    }
  }, [isAuthenticated, load]);

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
  getRemovalBlockerCounts: (
    specialty: Specialty
  ) => Promise<{ activeCount: number; pendingCount: number } | null>;
  addSpecialty: (specialty: Specialty) => Promise<SpecialtyActionErrorReason | null>;
  removeSpecialty: (specialtyId: string) => Promise<SpecialtyActionErrorReason | null>;
  upsertCredential: (
    specialtyId: string,
    input: { registryId: string; authority: string; country: string }
  ) => Promise<SpecialtyActionErrorReason | null>;
};

export function useSpecialties(isAuthenticated: boolean): UseSpecialtiesResult {
  const [state, setState] = useState<SpecialtiesLoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!isAuthenticated) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'loading' });

    void getProfessionalSpecialties()
      .then((specialties) => {
        setState({ kind: 'ready', specialties });
      })
      .catch((err: Error) => {
        setState({ kind: 'error', message: err.message });
      });
  }, [isAuthenticated]);

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

  const getRemovalBlockerCounts = useCallback(
    async (specialty: Specialty): Promise<{ activeCount: number; pendingCount: number } | null> => {
      if (!isAuthenticated) return null;
      try {
        return await getSpecialtyBlockerCounts(specialty);
      } catch {
        return null;
      }
    },
    [isAuthenticated]
  );

  const addSpecialty = useCallback(
    async (specialty: Specialty): Promise<SpecialtyActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      try {
        await addProfessionalSpecialty(specialty);
        load();
        return null;
      } catch (err) {
        return normalizeSpecialtyActionError(err);
      }
    },
    [isAuthenticated, load]
  );

  const removeSpecialty = useCallback(
    async (specialtyId: string): Promise<SpecialtyActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      try {
        await removeProfessionalSpecialty(specialtyId);
        load();
        return null;
      } catch (err) {
        return normalizeSpecialtyActionError(err);
      }
    },
    [isAuthenticated, load]
  );

  const upsertCredential = useCallback(
    async (
      specialtyId: string,
      input: { registryId: string; authority: string; country: string }
    ): Promise<SpecialtyActionErrorReason | null> => {
      if (!isAuthenticated) return 'unknown';

      try {
        await upsertProfessionalCredential(specialtyId, input);
        load();
        return null;
      } catch (err) {
        return normalizeSpecialtyActionError(err);
      }
    },
    [isAuthenticated, load]
  );

  return {
    state,
    reload: load,
    checkRemoval,
    getRemovalBlockerCounts,
    addSpecialty,
    removeSpecialty,
    upsertCredential,
  };
}
