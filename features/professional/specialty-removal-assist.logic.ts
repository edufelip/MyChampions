/**
 * Professional specialty removal assist flow (BL-011).
 * Provides direct actions to resolve blocking conditions when specialty removal is blocked.
 * Pure functions for assist state, action metadata, and validation.
 * Refs: D-076, FR-216, AC-258, BR-274, TC-262, TC-263
 */

import type { Specialty, SpecialtyRemovalBlockReason } from './specialty.logic';
import type { ConnectionRecord } from '@/features/connections/connection.logic';
import type { TranslationKey } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Type alias for backward compatibility.
 * @deprecated Use SpecialtyRemovalBlockReason from specialty.logic instead.
 */
export type SpecialtyRemovalBlocker = SpecialtyRemovalBlockReason;

export type AssistAction = 'view_active' | 'view_pending' | 'bulk_deny_pending' | 'add_specialty';

export type RemovalAssistState = {
  blocked: boolean;
  blockReason: SpecialtyRemovalBlockReason | null;
  activeStudentCount: number;
  pendingStudentCount: number;
  totalSpecialties: number;
  availableActions: AssistAction[];
};

export type AssistActionMetadata = {
  action: AssistAction;
  label: TranslationKey; // Localization key
  description: TranslationKey; // Localization key
  navigationTarget?: string; // Route to navigate to (e.g., "/professional/students?specialty=nutritionist")
  priority: 'primary' | 'secondary';
};

// ─── Assist State Resolution ────────────────────────────────────────────────────

/**
 * Determine removal assist state based on blocking conditions.
 */
export function resolveRemovalAssistState(input: {
  specialty: Specialty;
  activeStudentCount: number;
  pendingStudentCount: number;
  totalActiveSpecialties: number;
}): RemovalAssistState {
  const { activeStudentCount, pendingStudentCount, totalActiveSpecialties } = input;

  // Determine primary block reason (priority order: last_specialty, active, pending)
  let blockReason: SpecialtyRemovalBlockReason | null = null;
  const actions: AssistAction[] = [];

  if (totalActiveSpecialties <= 1) {
    blockReason = 'last_specialty';
    actions.push('add_specialty');
  } else if (activeStudentCount > 0) {
    blockReason = 'has_active_students';
    actions.push('view_active');
  } else if (pendingStudentCount > 0) {
    blockReason = 'has_pending_students';
    actions.push('view_pending', 'bulk_deny_pending');
  }

  return {
    blocked: blockReason !== null,
    blockReason,
    activeStudentCount,
    pendingStudentCount,
    totalSpecialties: totalActiveSpecialties,
    availableActions: actions,
  };
}

/**
 * Build metadata for assist actions (localization keys and navigation targets).
 */
export function buildActionMetadata(
  action: AssistAction,
  specialty: Specialty
): AssistActionMetadata {
  switch (action) {
    case 'view_active':
      return {
        action: 'view_active',
        label: 'pro.specialty.removal_assist.view_active',
        description: 'pro.specialty.removal_assist.view_active_desc',
        navigationTarget: `/professional/students?specialty=${specialty}`,
        priority: 'primary',
      };
    case 'view_pending':
      return {
        action: 'view_pending',
        label: 'pro.specialty.removal_assist.view_pending',
        description: 'pro.specialty.removal_assist.view_pending_desc',
        navigationTarget: '/professional/pending',
        priority: 'primary',
      };
    case 'bulk_deny_pending':
      return {
        action: 'bulk_deny_pending',
        label: 'pro.specialty.removal_assist.bulk_deny',
        description: 'pro.specialty.removal_assist.bulk_deny_desc',
        navigationTarget: '/professional/pending',
        priority: 'secondary',
      };
    case 'add_specialty':
      return {
        action: 'add_specialty',
        label: 'pro.specialty.removal_assist.add_specialty',
        description: 'pro.specialty.removal_assist.add_specialty_desc',
        navigationTarget: '/professional/settings/specialties',
        priority: 'primary',
      };
  }
}

/**
 * Filter blockers by specialty (for viewing student rosters during assist).
 */
export function filterBlockersBySpecialty(
  connections: ConnectionRecord[],
  specialty: Specialty,
  status: 'pending_confirmation' | 'active'
): ConnectionRecord[] {
  return connections.filter((c) => c.specialty === specialty && c.status === status);
}

/**
 * Count blockers by type (active vs pending) for a given specialty.
 */
export function countBlockers(
  connections: ConnectionRecord[],
  specialty: Specialty
): {
  activeCount: number;
  pendingCount: number;
} {
  const active = connections.filter(
    (c) => c.specialty === specialty && c.status === 'active'
  ).length;
  const pending = connections.filter(
    (c) => c.specialty === specialty && c.status === 'pending_confirmation'
  ).length;
  return { activeCount: active, pendingCount: pending };
}

/**
 * Determine if removal can now proceed after assist actions.
 */
export function canRemovalProceedNow(
  activeCount: number,
  pendingCount: number,
  totalSpecialties: number
): boolean {
  if (totalSpecialties <= 1) return false;
  if (activeCount > 0) return false;
  if (pendingCount > 0) return false;
  return true;
}

/**
 * Get localization keys for blocked removal message.
 * Returns structured keys and parameters for message formatting by UI layer.
 */
export function getRemovalBlockedMessageKeys(
  blockReason: SpecialtyRemovalBlockReason
): {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  bodyParams?: Record<string, string | number>;
} {
  switch (blockReason) {
    case 'has_active_students':
      return {
        titleKey: 'pro.specialty.removal_blocked.title',
        bodyKey: 'pro.specialty.removal_blocked.active_students_body',
      };
    case 'has_pending_students':
      return {
        titleKey: 'pro.specialty.removal_blocked.title',
        bodyKey: 'pro.specialty.removal_blocked.pending_students_body',
      };
    case 'last_specialty':
      return {
        titleKey: 'pro.specialty.removal_blocked.title',
        bodyKey: 'pro.specialty.removal_blocked.last_specialty_body',
      };
  }
}

/**
 * Format assist message for blocked removal state.
 * @deprecated Use getRemovalBlockedMessageKeys() instead for localization support.
 * Kept for backward compatibility; generates English-only messages.
 */
export function formatRemovalBlockedMessage(
  blockReason: SpecialtyRemovalBlockReason,
  activeCount: number,
  pendingCount: number
): {
  title: string;
  body: string;
} {
  const title = 'Cannot remove specialty';

  let body = '';
  switch (blockReason) {
    case 'has_active_students':
      body = `This specialty has ${activeCount} active student${activeCount !== 1 ? 's' : ''}. Unbind or complete active assignments first.`;
      break;
    case 'has_pending_students':
      body = `This specialty has ${pendingCount} pending student${pendingCount !== 1 ? 's' : ''}. Accept or deny pending requests first.`;
      break;
    case 'last_specialty':
      body = 'You must have at least one specialty. Add a new specialty before removing this one.';
      break;
  }

  return { title, body };
}

/**
 * Determine if assist UI should show blockers (active/pending students).
 */
export function shouldShowBlockers(blockReason: SpecialtyRemovalBlockReason | null): boolean {
  return blockReason === 'has_active_students' || blockReason === 'has_pending_students';
}
