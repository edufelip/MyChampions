import type { RoleIntent } from './role-selection.logic';

export type TabShellInput = {
  isHydrated: boolean;
  currentUid: string | null;
  lockedRole: RoleIntent | null;
  needsTermsAcceptance: boolean;
  establishedUid: string | null;
  establishedRole: RoleIntent | null;
};

export type TabShellResolution = {
  canUseEstablishedShell: boolean;
  effectiveRole: RoleIntent | null;
};

export function resolveTabShellState(input: TabShellInput): TabShellResolution {
  const canUseEstablishedShell =
    !input.isHydrated &&
    Boolean(input.currentUid) &&
    input.establishedUid === input.currentUid &&
    Boolean(input.establishedRole);

  const effectiveRole = input.isHydrated
    ? input.needsTermsAcceptance
      ? null
      : input.lockedRole
    : canUseEstablishedShell
      ? input.establishedRole
      : null;

  return { canUseEstablishedShell, effectiveRole };
}
