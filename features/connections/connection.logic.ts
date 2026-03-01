export type ConnectionStatus = 'invited' | 'pending_confirmation' | 'active' | 'ended';

export type CanceledReason = 'code_rotated' | null;

export type ConnectionSpecialty = 'nutritionist' | 'fitness_coach';

export type ConnectionRecord = {
  id: string;
  status: ConnectionStatus;
  canceledReason: CanceledReason;
  specialty: ConnectionSpecialty;
  professionalAuthUid: string;
};

export type ConnectionDisplayState =
  | { kind: 'pending'; connectionId: string; specialty: ConnectionSpecialty }
  | { kind: 'active'; connectionId: string; specialty: ConnectionSpecialty }
  | { kind: 'canceled_code_rotated'; connectionId: string; specialty: ConnectionSpecialty }
  | { kind: 'ended'; connectionId: string; specialty: ConnectionSpecialty };

export type InviteSubmitErrorReason =
  | 'code_not_found'
  | 'code_expired'
  | 'already_connected'
  | 'pending_cap_reached'
  | 'network'
  | 'configuration'
  | 'unknown';

export type ConnectionActionErrorReason =
  | 'connection_not_found'
  | 'invalid_transition'
  | 'network'
  | 'configuration'
  | 'unknown';

export function normalizeConnectionStatus(raw: unknown): ConnectionStatus | null {
  if (
    raw === 'invited' ||
    raw === 'pending_confirmation' ||
    raw === 'active' ||
    raw === 'ended'
  ) {
    return raw;
  }
  return null;
}

export function normalizeCanceledReason(raw: unknown): CanceledReason {
  return raw === 'code_rotated' ? 'code_rotated' : null;
}

export function normalizeConnectionSpecialty(raw: unknown): ConnectionSpecialty | null {
  if (raw === 'nutritionist' || raw === 'fitness_coach') return raw;
  return null;
}

export function resolveConnectionDisplayState(
  record: ConnectionRecord
): ConnectionDisplayState {
  if (record.status === 'pending_confirmation' || record.status === 'invited') {
    return { kind: 'pending', connectionId: record.id, specialty: record.specialty };
  }

  if (record.status === 'active') {
    return { kind: 'active', connectionId: record.id, specialty: record.specialty };
  }

  if (record.canceledReason === 'code_rotated') {
    return {
      kind: 'canceled_code_rotated',
      connectionId: record.id,
      specialty: record.specialty,
    };
  }

  return { kind: 'ended', connectionId: record.id, specialty: record.specialty };
}

export function normalizeInviteSubmitError(error: unknown): InviteSubmitErrorReason {
  if (error && typeof error === 'object') {
    const code =
      'code' in error ? String((error as { code: unknown }).code) : null;
    const message =
      'message' in error ? String((error as { message: unknown }).message) : null;

    if (code === 'CODE_NOT_FOUND' || message?.toLowerCase().includes('invite code not found')) {
      return 'code_not_found';
    }
    if (code === 'CODE_EXPIRED' || message?.toLowerCase().includes('invite code expired')) {
      return 'code_expired';
    }
    if (code === 'ALREADY_CONNECTED' || message?.toLowerCase().includes('already connected')) {
      return 'already_connected';
    }
    if (
      code === 'PENDING_CAP_REACHED' ||
      message?.toLowerCase().includes('pending cap') ||
      message?.toLowerCase().includes('pending limit')
    ) {
      return 'pending_cap_reached';
    }
    if (code === 'NETWORK_ERROR' || message?.toLowerCase().includes('network')) {
      return 'network';
    }
    if (message?.toLowerCase().includes('endpoint') || message?.toLowerCase().includes('config')) {
      return 'configuration';
    }
  }
  return 'unknown';
}

export function normalizeConnectionActionError(
  error: unknown
): ConnectionActionErrorReason {
  if (error && typeof error === 'object') {
    const code =
      'code' in error ? String((error as { code: unknown }).code) : null;
    const message =
      'message' in error ? String((error as { message: unknown }).message) : null;

    if (
      code === 'CONNECTION_NOT_FOUND' ||
      message?.toLowerCase().includes('connection not found')
    ) {
      return 'connection_not_found';
    }
    if (
      code === 'INVALID_TRANSITION' ||
      message?.toLowerCase().includes('invalid transition') ||
      message?.toLowerCase().includes('cannot transition')
    ) {
      return 'invalid_transition';
    }
    if (code === 'NETWORK_ERROR' || message?.toLowerCase().includes('network')) {
      return 'network';
    }
    if (message?.toLowerCase().includes('endpoint') || message?.toLowerCase().includes('config')) {
      return 'configuration';
    }
  }
  return 'unknown';
}
