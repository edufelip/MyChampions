/**
 * Professional source — server-first invite code and specialty operations.
 */

import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import { getCurrentServerAccessToken } from '../auth/server-auth-source';
import {
  normalizeInviteCodeStatus,
  type InviteCode,
} from './connection-invite.logic';
import {
  normalizeSpecialty,
  type Specialty,
  type SpecialtyRecord,
  type Credential,
} from './specialty.logic';
import {
  normalizeConnectionSpecialty,
  normalizeConnectionStatus,
  type ConnectionSpecialty,
  type ConnectionStatus,
} from '../connections/connection.logic';
import { endConnection } from '../connections/connection-source';

// ─── Error class ──────────────────────────────────────────────────────────────

type ProfessionalSourceErrorCode =
  | 'configuration'
  | 'network'
  | 'graphql'
  | 'invalid_response';

export class ProfessionalSourceError extends Error {
  code: ProfessionalSourceErrorCode;

  constructor(code: ProfessionalSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProfessionalSourceError';
  }
}

export type ProfessionalStudentRosterItem = {
  studentAuthUid: string;
  displayName: string;
  specialty: ConnectionSpecialty;
  assignmentStatus: 'active' | 'pending';
  nutritionStatus: 'active' | 'pending' | 'none';
  trainingStatus: 'active' | 'pending' | 'none';
};

export type ProfessionalStudentAssignmentSnapshot = {
  studentAuthUid: string;
  displayName: string;
  nutritionStatus: 'active' | 'pending' | 'none';
  trainingStatus: 'active' | 'pending' | 'none';
  activeConnectionIds: string[];
};

export type SpecialtyBlockerCounts = {
  activeCount: number;
  pendingCount: number;
};

export type ProfessionalSourceDeps = {
  getCurrentAccessToken?: () => Promise<string | null>;
  getServerBaseUrl?: () => string | undefined;
  fetchFn: typeof fetch;
  generateInviteCode: () => string;
};

function nowIso(): string {
  return new Date().toISOString();
}

const defaultDeps: ProfessionalSourceDeps = {
  getCurrentAccessToken: async () => getCurrentServerAccessToken(),
  getServerBaseUrl: resolveServerBaseUrl,
  fetchFn: fetch,
  generateInviteCode: () => Math.random().toString(36).slice(2, 8).toUpperCase(),
};

const e2eSpecialtyRecords = new Map<Specialty, SpecialtyRecord>();
const e2eInviteCodeRecords = new Map<Specialty, InviteCode>();
let e2eInviteCodeSequence = 0;

function getE2ESourceOverride() {
  return resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

function resolveServerBaseUrl(): string | undefined {
  let expoExtra: unknown;
  try {
    const Constants = require('expo-constants') as {
      default?: { expoConfig?: { extra?: unknown } };
      expoConfig?: { extra?: unknown };
    };
    expoExtra = (Constants.default ?? Constants).expoConfig?.extra;
  } catch {
    expoExtra = undefined;
  }

  const extra = (expoExtra ?? {}) as {
    server?: {
      baseUrl?: string;
    };
  };
  return extra.server?.baseUrl?.trim() || process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL?.trim();
}

function cloneE2ESpecialty(record: SpecialtyRecord): SpecialtyRecord {
  return {
    ...record,
    credential: record.credential ? { ...record.credential } : null,
  };
}

function cloneE2EInviteCode(record: InviteCode): InviteCode {
  return { ...record };
}

function buildE2EInviteCodeValue(specialty: Specialty): string {
  e2eInviteCodeSequence += 1;
  const prefix = specialty === 'nutritionist' ? 'NUT' : 'FIT';
  return `E2E-${prefix}${String(e2eInviteCodeSequence).padStart(3, '0')}`;
}

function getActiveE2ESpecialty(specialty: Specialty): SpecialtyRecord | null {
  const record = e2eSpecialtyRecords.get(specialty);
  return record?.isActive ? record : null;
}

function getE2EProfessionalRosterFixture(): ProfessionalStudentRosterItem[] | null {
  if (process.env.EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE !== 'basic') return null;

  return [
    {
      studentAuthUid: 'e2e-active-student',
      displayName: 'Ada Active',
      specialty: 'nutritionist',
      assignmentStatus: 'active',
      nutritionStatus: 'active',
      trainingStatus: 'none',
    },
    {
      studentAuthUid: 'e2e-dual-student',
      displayName: 'Drew Dual',
      specialty: 'nutritionist',
      assignmentStatus: 'active',
      nutritionStatus: 'active',
      trainingStatus: 'active',
    },
    {
      studentAuthUid: 'e2e-pending-student',
      displayName: 'Pia Pending',
      specialty: 'fitness_coach',
      assignmentStatus: 'pending',
      nutritionStatus: 'none',
      trainingStatus: 'pending',
    },
  ];
}

function buildE2EConnectionId(studentAuthUid: string, specialty: ConnectionSpecialty): string {
  return `e2e-connection-${studentAuthUid}-${specialty}`;
}

function getE2EProfessionalStudentAssignmentSnapshotFixture(
  studentAuthUid: string
): ProfessionalStudentAssignmentSnapshot | null {
  const fixture = getE2EProfessionalRosterFixture();
  if (!fixture) return null;

  const row = fixture.find((student) => student.studentAuthUid === studentAuthUid);
  if (!row) {
    return {
      studentAuthUid,
      displayName: studentAuthUid,
      nutritionStatus: 'none',
      trainingStatus: 'none',
      activeConnectionIds: [],
    };
  }

  const activeConnectionIds: string[] = [];
  if (row.nutritionStatus === 'active') {
    activeConnectionIds.push(buildE2EConnectionId(studentAuthUid, 'nutritionist'));
  }
  if (row.trainingStatus === 'active') {
    activeConnectionIds.push(buildE2EConnectionId(studentAuthUid, 'fitness_coach'));
  }

  return {
    studentAuthUid,
    displayName: row.displayName,
    nutritionStatus: row.nutritionStatus,
    trainingStatus: row.trainingStatus,
    activeConnectionIds,
  };
}

function getOrCreateE2EInviteCode(specialty: Specialty, rotatedAt: string | null = null): InviteCode | null {
  if (!getActiveE2ESpecialty(specialty)) return null;

  const existing = e2eInviteCodeRecords.get(specialty);
  if (existing && existing.status === 'active' && !rotatedAt) {
    return cloneE2EInviteCode(existing);
  }

  const timestamp = nowIso();
  const next: InviteCode = {
    id: specialty,
    codeValue: buildE2EInviteCodeValue(specialty),
    specialty,
    status: 'active',
    rotatedAt,
    expiresAt: null,
    createdAt: existing?.createdAt ?? timestamp,
  };
  e2eInviteCodeRecords.set(specialty, next);
  return cloneE2EInviteCode(next);
}

function summarizeStudentConnections(
  rows: Array<{ status: ConnectionStatus; specialty: ConnectionSpecialty }>
): {
  assignmentStatus: 'active' | 'pending' | null;
  representativeSpecialty: ConnectionSpecialty;
  nutritionStatus: 'active' | 'pending' | 'none';
  trainingStatus: 'active' | 'pending' | 'none';
} {
  let nutritionStatus: 'active' | 'pending' | 'none' = 'none';
  let trainingStatus: 'active' | 'pending' | 'none' = 'none';

  for (const row of rows) {
    const nextStatus = row.status === 'active' ? 'active' : row.status === 'pending_confirmation' ? 'pending' : 'none';
    if (nextStatus === 'none') continue;

    if (row.specialty === 'nutritionist') {
      if (nutritionStatus !== 'active') nutritionStatus = nextStatus;
      continue;
    }

    if (trainingStatus !== 'active') trainingStatus = nextStatus;
  }

  const assignmentStatus = nutritionStatus === 'active' || trainingStatus === 'active'
    ? 'active'
    : nutritionStatus === 'pending' || trainingStatus === 'pending'
      ? 'pending'
      : null;

  const representativeSpecialty =
    nutritionStatus !== 'none' ? 'nutritionist' : 'fitness_coach';

  return { assignmentStatus, representativeSpecialty, nutritionStatus, trainingStatus };
}

function normalizeProfessionalSourceError(error: unknown): ProfessionalSourceError {
  if (error instanceof ProfessionalSourceError) return error;
  return new ProfessionalSourceError(
    'invalid_response',
    (error as Error)?.message ?? 'Unexpected professional source error.'
  );
}

function requireServerResult<T>(result: T | null, operation: string): T {
  if (result !== null) return result;
  throw new ProfessionalSourceError('configuration', `${operation} requires local server auth.`);
}

function buildSpecialtyId(professionalUid: string, specialty: Specialty): string {
  return `${professionalUid}_${specialty}`;
}

export function buildInviteCodePath(professionalUid: string, specialty: Specialty): [string, string, string, string] {
  return ['professionals', professionalUid, 'inviteCodes', specialty];
}

export function buildInviteCodeLookupPath(codeValue: string): [string, string] {
  return ['inviteCodeLookups', codeValue];
}

export function countUniqueActiveStudents(
  rows: Array<{ status?: unknown; studentAuthUid?: unknown }>
): number {
  const activeStudents = new Set<string>();
  for (const row of rows) {
    if (normalizeConnectionStatus(row.status) !== 'active') continue;
    const studentAuthUid = typeof row.studentAuthUid === 'string' ? row.studentAuthUid.trim() : '';
    if (!studentAuthUid) continue;
    activeStudents.add(studentAuthUid);
  }
  return activeStudents.size;
}

type ServerInviteCodeResponse = {
  inviteCode?: {
    id?: unknown;
    codeValue?: unknown;
    specialty?: unknown;
    status?: unknown;
    rotatedAt?: unknown;
    expiresAt?: unknown;
    createdAt?: unknown;
  };
  error?: { code?: unknown; message?: unknown } | string;
};

type ServerProfessionalSpecialtiesResponse = {
  activeCount?: unknown;
  pendingCount?: unknown;
  credential?: {
    id?: unknown;
    specialty?: unknown;
    credentialType?: unknown;
    registryId?: unknown;
    authority?: unknown;
    country?: unknown;
  };
  specialties?: Array<{
    id?: unknown;
    specialty?: unknown;
    isActive?: unknown;
    credential?: {
      id?: unknown;
      specialty?: unknown;
      credentialType?: unknown;
      registryId?: unknown;
      authority?: unknown;
      country?: unknown;
    } | null;
  }>;
  specialty?: {
    id?: unknown;
    specialty?: unknown;
    isActive?: unknown;
    credential?: {
      id?: unknown;
      specialty?: unknown;
      credentialType?: unknown;
      registryId?: unknown;
      authority?: unknown;
      country?: unknown;
    } | null;
  };
  error?: { code?: unknown; message?: unknown } | string;
};

type ServerProfessionalStudentsResponse = {
  students?: Array<{
    studentAuthUid?: unknown;
    displayName?: unknown;
    specialty?: unknown;
    assignmentStatus?: unknown;
    nutritionStatus?: unknown;
    trainingStatus?: unknown;
  }>;
  error?: { code?: unknown; message?: unknown } | string;
};

type ServerProfessionalStudentAssignmentSnapshotResponse = {
  snapshot?: {
    studentAuthUid?: unknown;
    displayName?: unknown;
    nutritionStatus?: unknown;
    trainingStatus?: unknown;
    activeConnectionIds?: unknown;
  };
  error?: { code?: unknown; message?: unknown } | string;
};

async function readServerInviteCodeJson(response: Response): Promise<ServerInviteCodeResponse | null> {
  try {
    return (await response.json()) as ServerInviteCodeResponse;
  } catch {
    return null;
  }
}

async function readServerProfessionalSpecialtiesJson(
  response: Response
): Promise<ServerProfessionalSpecialtiesResponse | null> {
  try {
    return (await response.json()) as ServerProfessionalSpecialtiesResponse;
  } catch {
    return null;
  }
}

function mapServerInviteCode(payload: ServerInviteCodeResponse | null): InviteCode {
  const raw = payload?.inviteCode;
  const specialty = normalizeSpecialty(raw?.specialty);
  const status = normalizeInviteCodeStatus(raw?.status);
  if (
    !raw ||
    typeof raw.id !== 'string' ||
    typeof raw.codeValue !== 'string' ||
    !specialty ||
    !status ||
    typeof raw.createdAt !== 'string'
  ) {
    throw new ProfessionalSourceError('invalid_response', 'Invite code server response is invalid.');
  }

  return {
    id: raw.id,
    codeValue: raw.codeValue,
    specialty,
    status,
    rotatedAt: typeof raw.rotatedAt === 'string' ? raw.rotatedAt : null,
    expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : null,
    createdAt: raw.createdAt,
  };
}

function mapServerCredential(raw: NonNullable<ServerProfessionalSpecialtiesResponse['specialty']>['credential']): Credential | null {
  if (raw === null || raw === undefined) return null;
  const specialty = normalizeSpecialty(raw.specialty);
  if (
    typeof raw.id !== 'string' ||
    !specialty ||
    raw.credentialType !== 'professional_registry' ||
    typeof raw.registryId !== 'string' ||
    typeof raw.authority !== 'string' ||
    typeof raw.country !== 'string'
  ) {
    throw new ProfessionalSourceError('invalid_response', 'Professional specialty credential server response is invalid.');
  }

  return {
    id: raw.id,
    specialty,
    credentialType: 'professional_registry',
    registryId: raw.registryId,
    authority: raw.authority,
    country: raw.country,
  };
}

function mapServerSpecialtyRecord(
  raw: NonNullable<ServerProfessionalSpecialtiesResponse['specialties']>[number]
): SpecialtyRecord {
  const specialty = normalizeSpecialty(raw.specialty);
  if (
    typeof raw.id !== 'string' ||
    !specialty ||
    typeof raw.isActive !== 'boolean'
  ) {
    throw new ProfessionalSourceError('invalid_response', 'Professional specialty server response is invalid.');
  }

  return {
    id: raw.id,
    specialty,
    isActive: raw.isActive,
    credential: mapServerCredential(raw.credential),
  };
}

function normalizeServerInviteCodeError(
  status: number,
  payload: ServerInviteCodeResponse | null
): ProfessionalSourceError {
  const rawError = payload?.error;
  const message = typeof rawError === 'object' && rawError && typeof rawError.message === 'string'
    ? rawError.message
    : `Invite code server request failed with status ${status}.`;

  if (status === 401 || status === 403) {
    return new ProfessionalSourceError('graphql', message);
  }
  if (status >= 500) {
    return new ProfessionalSourceError('network', message);
  }
  return new ProfessionalSourceError('invalid_response', message);
}

function normalizeServerProfessionalSpecialtyError(
  status: number,
  payload: ServerProfessionalSpecialtiesResponse | null
): ProfessionalSourceError {
  const rawError = payload?.error;
  const rawCode = typeof rawError === 'object' && rawError && typeof rawError.code === 'string'
    ? rawError.code
    : typeof rawError === 'string'
      ? rawError
      : null;
  const message = typeof rawError === 'object' && rawError && typeof rawError.message === 'string'
    ? rawError.message
    : `Professional specialty server request failed with status ${status}.`;

  if (rawCode === 'last_specialty') {
    return new ProfessionalSourceError('graphql', message || 'Cannot remove the last active Specialty.');
  }
  if (rawCode === 'removal_blocked') {
    return new ProfessionalSourceError('graphql', message || 'Specialty removal blocked by active/pending students.');
  }
  if (status === 401 || status === 403 || status === 404 || status === 409) {
    return new ProfessionalSourceError('graphql', message);
  }
  if (status >= 500) {
    return new ProfessionalSourceError('network', message);
  }
  return new ProfessionalSourceError('invalid_response', message);
}

async function requestInviteCodeFromServer(
  specialty: Specialty,
  deps: ProfessionalSourceDeps,
  action: 'read' | 'rotate'
): Promise<InviteCode | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;

  const path = action === 'rotate'
    ? `/professional/invite-codes/${specialty}/rotate`
    : `/professional/invite-codes/${specialty}`;

  let response: Response;
  try {
    response = await deps.fetchFn(`${baseUrl}${path}`, {
      method: action === 'rotate' ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ProfessionalSourceError('network', 'Network request to invite code server failed.');
  }

  const payload = await readServerInviteCodeJson(response);
  if (!response.ok) {
    throw normalizeServerInviteCodeError(response.status, payload);
  }

  return mapServerInviteCode(payload);
}

async function requestProfessionalSpecialtiesFromServer(
  deps: ProfessionalSourceDeps
): Promise<SpecialtyRecord[] | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;

  let response: Response;
  try {
    response = await deps.fetchFn(`${baseUrl}/professional/specialties`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ProfessionalSourceError('network', 'Network request to professional specialties server failed.');
  }

  const payload = await readServerProfessionalSpecialtiesJson(response);
  if (!response.ok) {
    throw normalizeServerProfessionalSpecialtyError(response.status, payload);
  }
  if (!Array.isArray(payload?.specialties)) {
    throw new ProfessionalSourceError('invalid_response', 'Professional specialties server response is missing specialties.');
  }

  return payload.specialties.map(mapServerSpecialtyRecord);
}

async function getSpecialtyBlockerCountsFromServer(
  specialty: Specialty,
  deps: ProfessionalSourceDeps
): Promise<SpecialtyBlockerCounts | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;

  let response: Response;
  try {
    response = await deps.fetchFn(`${baseUrl}/professional/specialties/${specialty}/blockers`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ProfessionalSourceError('network', 'Network request to professional specialty blockers server failed.');
  }

  const payload = await readServerProfessionalSpecialtiesJson(response);
  if (!response.ok) {
    throw normalizeServerProfessionalSpecialtyError(response.status, payload);
  }

  if (typeof payload?.activeCount !== 'number' || typeof payload.pendingCount !== 'number') {
    throw new ProfessionalSourceError('invalid_response', 'Professional specialty blockers server response is invalid.');
  }

  return {
    activeCount: payload.activeCount,
    pendingCount: payload.pendingCount,
  };
}

async function addProfessionalSpecialtyToServer(
  specialty: Specialty,
  deps: ProfessionalSourceDeps
): Promise<{ id: string; specialty: Specialty } | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;

  let response: Response;
  try {
    response = await deps.fetchFn(`${baseUrl}/professional/specialties`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ specialty }),
    });
  } catch {
    throw new ProfessionalSourceError('network', 'Network request to add professional specialty failed.');
  }

  const payload = await readServerProfessionalSpecialtiesJson(response);
  if (!response.ok) {
    throw normalizeServerProfessionalSpecialtyError(response.status, payload);
  }
  if (!payload?.specialty) {
    throw new ProfessionalSourceError('invalid_response', 'Professional specialty server response is missing specialty.');
  }

  const record = mapServerSpecialtyRecord(payload.specialty);
  return { id: record.id, specialty: record.specialty };
}

async function removeProfessionalSpecialtyFromServer(
  specialtyId: string,
  deps: ProfessionalSourceDeps
): Promise<boolean> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return false;

  let response: Response;
  try {
    response = await deps.fetchFn(`${baseUrl}/professional/specialties/${encodeURIComponent(specialtyId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ProfessionalSourceError('network', 'Network request to remove professional specialty failed.');
  }

  if (response.ok) return true;

  const payload = await readServerProfessionalSpecialtiesJson(response);
  throw normalizeServerProfessionalSpecialtyError(response.status, payload);
}

async function upsertProfessionalCredentialToServer(
  specialtyId: string,
  input: { registryId: string; authority: string; country: string },
  deps: ProfessionalSourceDeps
): Promise<{ id: string } | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;

  let response: Response;
  try {
    response = await deps.fetchFn(`${baseUrl}/professional/specialties/${encodeURIComponent(specialtyId)}/credential`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ProfessionalSourceError('network', 'Network request to upsert professional credential failed.');
  }

  const payload = await readServerProfessionalSpecialtiesJson(response);
  if (!response.ok) {
    throw normalizeServerProfessionalSpecialtyError(response.status, payload);
  }

  const credential = mapServerCredential(payload?.credential);
  if (!credential) {
    throw new ProfessionalSourceError('invalid_response', 'Professional credential server response is missing credential.');
  }

  return { id: credential.id };
}

function normalizeAssignmentStatus(value: unknown): 'active' | 'pending' | 'none' | null {
  return value === 'active' || value === 'pending' || value === 'none' ? value : null;
}

function normalizeRosterAssignmentStatus(value: unknown): 'active' | 'pending' | null {
  return value === 'active' || value === 'pending' ? value : null;
}

function mapServerRosterItem(
  raw: NonNullable<ServerProfessionalStudentsResponse['students']>[number]
): ProfessionalStudentRosterItem {
  const specialty = normalizeConnectionSpecialty(raw.specialty);
  const assignmentStatus = normalizeRosterAssignmentStatus(raw.assignmentStatus);
  const nutritionStatus = normalizeAssignmentStatus(raw.nutritionStatus);
  const trainingStatus = normalizeAssignmentStatus(raw.trainingStatus);
  if (
    typeof raw.studentAuthUid !== 'string' ||
    typeof raw.displayName !== 'string' ||
    !specialty ||
    !assignmentStatus ||
    !nutritionStatus ||
    !trainingStatus
  ) {
    throw new ProfessionalSourceError('invalid_response', 'Professional students server response is invalid.');
  }

  return {
    studentAuthUid: raw.studentAuthUid,
    displayName: raw.displayName,
    specialty,
    assignmentStatus,
    nutritionStatus,
    trainingStatus,
  };
}

function mapServerAssignmentSnapshot(
  payload: ServerProfessionalStudentAssignmentSnapshotResponse | null
): ProfessionalStudentAssignmentSnapshot {
  const raw = payload?.snapshot;
  const nutritionStatus = normalizeAssignmentStatus(raw?.nutritionStatus);
  const trainingStatus = normalizeAssignmentStatus(raw?.trainingStatus);
  if (
    !raw ||
    typeof raw.studentAuthUid !== 'string' ||
    typeof raw.displayName !== 'string' ||
    !nutritionStatus ||
    !trainingStatus ||
    !Array.isArray(raw.activeConnectionIds) ||
    raw.activeConnectionIds.some((id) => typeof id !== 'string')
  ) {
    throw new ProfessionalSourceError('invalid_response', 'Professional student assignment server response is invalid.');
  }

  return {
    studentAuthUid: raw.studentAuthUid,
    displayName: raw.displayName,
    nutritionStatus,
    trainingStatus,
    activeConnectionIds: raw.activeConnectionIds,
  };
}

function normalizeServerProfessionalStudentsError(
  status: number,
  payload: ServerProfessionalStudentsResponse | ServerProfessionalStudentAssignmentSnapshotResponse | null
): ProfessionalSourceError {
  const rawError = payload?.error;
  const message = typeof rawError === 'object' && rawError && typeof rawError.message === 'string'
    ? rawError.message
    : `Professional students server request failed with status ${status}.`;

  if (status === 401 || status === 403) {
    return new ProfessionalSourceError('graphql', message);
  }
  if (status >= 500) {
    return new ProfessionalSourceError('network', message);
  }
  return new ProfessionalSourceError('invalid_response', message);
}

async function readServerProfessionalStudentsJson(
  response: Response
): Promise<ServerProfessionalStudentsResponse | null> {
  try {
    return (await response.json()) as ServerProfessionalStudentsResponse;
  } catch {
    return null;
  }
}

async function readServerAssignmentSnapshotJson(
  response: Response
): Promise<ServerProfessionalStudentAssignmentSnapshotResponse | null> {
  try {
    return (await response.json()) as ServerProfessionalStudentAssignmentSnapshotResponse;
  } catch {
    return null;
  }
}

async function requestProfessionalStudentRosterFromServer(
  deps: ProfessionalSourceDeps
): Promise<ProfessionalStudentRosterItem[] | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;

  let response: Response;
  try {
    response = await deps.fetchFn(`${baseUrl}/professional/students`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ProfessionalSourceError('network', 'Network request to professional students server failed.');
  }

  const payload = await readServerProfessionalStudentsJson(response);
  if (!response.ok) {
    throw normalizeServerProfessionalStudentsError(response.status, payload);
  }
  if (!Array.isArray(payload?.students)) {
    throw new ProfessionalSourceError('invalid_response', 'Professional students server response is missing students.');
  }

  return payload.students.map(mapServerRosterItem);
}

async function requestProfessionalStudentAssignmentSnapshotFromServer(
  studentAuthUid: string,
  deps: ProfessionalSourceDeps
): Promise<ProfessionalStudentAssignmentSnapshot | null> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl || !accessToken) return null;

  let response: Response;
  try {
    response = await deps.fetchFn(
      `${baseUrl}/professional/students/${encodeURIComponent(studentAuthUid)}/assignment-snapshot`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
      }
    );
  } catch {
    throw new ProfessionalSourceError('network', 'Network request to professional student assignment server failed.');
  }

  const payload = await readServerAssignmentSnapshotJson(response);
  if (!response.ok) {
    throw normalizeServerProfessionalStudentsError(response.status, payload);
  }

  return mapServerAssignmentSnapshot(payload);
}

export async function getOrCreateActiveInviteCode(
  specialty: Specialty,
  deps = defaultDeps
): Promise<InviteCode | null> {
  if (deps === defaultDeps && getE2ESourceOverride()) {
    return getOrCreateE2EInviteCode(specialty);
  }

  try {
    const serverInviteCode = await requestInviteCodeFromServer(specialty, deps, 'read');
    return requireServerResult(serverInviteCode, 'Invite-code reads');
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function rotateInviteCode(specialty: Specialty, deps = defaultDeps): Promise<InviteCode> {
  if (deps === defaultDeps && getE2ESourceOverride()) {
    const code = getOrCreateE2EInviteCode(specialty, nowIso());
    if (!code) {
      throw new ProfessionalSourceError('configuration', 'No active Specialty found for invite code rotation.');
    }
    return code;
  }

  try {
    const serverInviteCode = await requestInviteCodeFromServer(specialty, deps, 'rotate');
    return requireServerResult(serverInviteCode, 'Invite-code rotation');
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function getProfessionalSpecialties(deps = defaultDeps): Promise<SpecialtyRecord[]> {
  if (deps === defaultDeps && getE2ESourceOverride()) {
    return [...e2eSpecialtyRecords.values()].map(cloneE2ESpecialty);
  }

  try {
    const serverSpecialties = await requestProfessionalSpecialtiesFromServer(deps);
    return requireServerResult(serverSpecialties, 'Professional specialty reads');
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function addProfessionalSpecialty(
  specialty: Specialty,
  deps = defaultDeps
): Promise<{ id: string; specialty: Specialty }> {
  const e2eSourceOverride = deps === defaultDeps ? getE2ESourceOverride() : null;
  if (e2eSourceOverride) {
    const id = buildSpecialtyId(e2eSourceOverride.uid, specialty);
    const current = e2eSpecialtyRecords.get(specialty);
    e2eSpecialtyRecords.set(specialty, {
      id,
      specialty,
      isActive: true,
      credential: current?.credential ?? null,
    });
    return { id, specialty };
  }

  try {
    const serverSpecialty = await addProfessionalSpecialtyToServer(specialty, deps);
    return requireServerResult(serverSpecialty, 'Professional specialty creation');
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function removeProfessionalSpecialty(
  specialtyId: string,
  deps = defaultDeps
): Promise<void> {
  if (deps === defaultDeps && getE2ESourceOverride()) {
    for (const [specialty, record] of e2eSpecialtyRecords.entries()) {
      if (record.id === specialtyId) {
        e2eSpecialtyRecords.delete(specialty);
        return;
      }
    }
    throw new ProfessionalSourceError('graphql', 'Specialty not found.');
  }

  try {
    if (await removeProfessionalSpecialtyFromServer(specialtyId, deps)) {
      return;
    }

    throw new ProfessionalSourceError('configuration', 'Specialty removal requires local server auth.');
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function getSpecialtyBlockerCounts(
  specialty: Specialty,
  deps = defaultDeps
): Promise<SpecialtyBlockerCounts> {
  if (deps === defaultDeps && getE2ESourceOverride()) {
    return { activeCount: 0, pendingCount: 0 };
  }

  try {
    const serverCounts = await getSpecialtyBlockerCountsFromServer(specialty, deps);
    return requireServerResult(serverCounts, 'Professional specialty blocker reads');
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function upsertProfessionalCredential(
  specialtyId: string,
  input: { registryId: string; authority: string; country: string },
  deps = defaultDeps
): Promise<{ id: string }> {
  const e2eSourceOverride = deps === defaultDeps ? getE2ESourceOverride() : null;
  if (e2eSourceOverride) {
    for (const [specialty, record] of e2eSpecialtyRecords.entries()) {
      if (record.id !== specialtyId) continue;
      e2eSpecialtyRecords.set(specialty, {
        ...record,
        credential: {
          id: specialtyId,
          specialty,
          credentialType: 'professional_registry',
          registryId: input.registryId,
          authority: input.authority,
          country: input.country,
        },
      });
      return { id: specialtyId };
    }
    throw new ProfessionalSourceError('graphql', 'Specialty not found for credential upsert.');
  }

  try {
    const serverCredential = await upsertProfessionalCredentialToServer(specialtyId, input, deps);
    return requireServerResult(serverCredential, 'Professional credential upsert');
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function getProfessionalStudentRoster(
  deps = defaultDeps
): Promise<ProfessionalStudentRosterItem[]> {
  if (deps === defaultDeps && getE2ESourceOverride()) {
    const fixture = getE2EProfessionalRosterFixture();
    if (fixture) return fixture.map((student) => ({ ...student }));
  }

  try {
    const serverRoster = await requestProfessionalStudentRosterFromServer(deps);
    return requireServerResult(serverRoster, 'Professional student roster reads');
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function getActiveProfessionalStudentCount(
  deps = defaultDeps
): Promise<number> {
  if (deps === defaultDeps && getE2ESourceOverride()) {
    const fixture = getE2EProfessionalRosterFixture();
    if (fixture) return countUniqueActiveStudents(fixture);
    return 0;
  }

  try {
    const serverRoster = await requestProfessionalStudentRosterFromServer(deps);
    return requireServerResult(
      serverRoster?.filter((student) => student.assignmentStatus === 'active').length ?? null,
      'Professional active-student count reads'
    );
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function getProfessionalStudentAssignmentSnapshot(
  studentAuthUid: string,
  deps = defaultDeps
): Promise<ProfessionalStudentAssignmentSnapshot> {
  if (deps === defaultDeps && getE2ESourceOverride()) {
    const fixture = getE2EProfessionalStudentAssignmentSnapshotFixture(studentAuthUid);
    if (fixture) return { ...fixture, activeConnectionIds: [...fixture.activeConnectionIds] };
  }

  try {
    const serverSnapshot = await requestProfessionalStudentAssignmentSnapshotFromServer(studentAuthUid, deps);
    return requireServerResult(serverSnapshot, 'Professional assignment snapshot reads');
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}

export async function unbindStudentConnections(
  studentAuthUid: string,
  deps = defaultDeps
): Promise<void> {
  try {
    const snapshot = requireServerResult(
      await requestProfessionalStudentAssignmentSnapshotFromServer(studentAuthUid, deps),
      'Professional student unbind'
    );
    await Promise.all(
      snapshot.activeConnectionIds.map((connectionId) =>
        endConnection(connectionId, deps as unknown as Parameters<typeof endConnection>[1])
      )
    );
  } catch (error) {
    throw normalizeProfessionalSourceError(error);
  }
}
