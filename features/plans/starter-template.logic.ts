/**
 * Starter template logic — template selection, cloning, and customization (BL-006).
 * Pure functions for template operations without Firebase dependencies.
 * Refs: D-114, FR-212, FR-247, AC-256, BR-270, TC-260, UC-002.14
 */

import type { PlanType } from './plan-change-request.logic';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StarterTemplate = {
  id: string;
  planType: PlanType;
  name: string;
  description?: string;
  createdAt?: string;
};

export type TemplateCloneInput = {
  templateId: string;
  newPlanName: string;
};

export type TemplateCloneValidationErrors = {
  templateId?: 'required' | 'invalid_format';
  newPlanName?: 'required' | 'too_short' | 'too_long';
};

export type TemplateLibraryFilter = {
  planType?: PlanType | null;
  searchQuery?: string;
};

export type StarterTemplateCategory = 'nutrition' | 'training';

// ─── Constants ─────────────────────────────────────────────────────────────────

const MIN_PLAN_NAME_LENGTH = 2;
const MAX_PLAN_NAME_LENGTH = 100;
const STARTER_TEMPLATE_ID_PREFIX = 'starter_';

// ─── Starter Template Detection ────────────────────────────────────────────────

/**
 * Check if a plan ID represents a starter template.
 * Starter templates are identified by the 'starter_' prefix.
 */
export function isStarterTemplate(planId: string): boolean {
  return planId.startsWith(STARTER_TEMPLATE_ID_PREFIX);
}

/**
 * Extract template category from template ID.
 * Format: starter_nutrition_basic or starter_training_full_body
 */
export function extractTemplateCategory(templateId: string): StarterTemplateCategory | null {
  if (!isStarterTemplate(templateId)) return null;
  
  const parts = templateId.split('_');
  if (parts.length < 2) return null;
  
  const category = parts[1];
  if (category === 'nutrition' || category === 'training') {
    return category as StarterTemplateCategory;
  }
  
  return null;
}

// ─── Template Cloning Validation ───────────────────────────────────────────────

/**
 * Validate clone template input.
 * Checks template ID format and new plan name requirements.
 */
export function validateTemplateClone(input: TemplateCloneInput): TemplateCloneValidationErrors {
  const errors: TemplateCloneValidationErrors = {};

  if (!input.templateId) {
    errors.templateId = 'required';
  } else if (!isStarterTemplate(input.templateId)) {
    errors.templateId = 'invalid_format';
  }

  if (!input.newPlanName.trim()) {
    errors.newPlanName = 'required';
  } else if (input.newPlanName.trim().length < MIN_PLAN_NAME_LENGTH) {
    errors.newPlanName = 'too_short';
  } else if (input.newPlanName.length > MAX_PLAN_NAME_LENGTH) {
    errors.newPlanName = 'too_long';
  }

  return errors;
}

/**
 * Determine if clone can proceed (no validation errors).
 */
export function canCloneTemplate(errors: TemplateCloneValidationErrors): boolean {
  return Object.keys(errors).length === 0;
}

// ─── Template Library Filtering ────────────────────────────────────────────────

/**
 * Filter starter templates by plan type and/or search query.
 */
export function filterStarterTemplates(
  templates: StarterTemplate[],
  filter: TemplateLibraryFilter
): StarterTemplate[] {
  let filtered = templates;

  // Filter by plan type if specified
  if (filter.planType) {
    filtered = filtered.filter((t) => t.planType === filter.planType);
  }

  // Filter by search query (name or ID substring, case-insensitive)
  if (filter.searchQuery?.trim()) {
    const query = filter.searchQuery.trim().toLowerCase();
    filtered = filtered.filter((t) => {
      const nameMatch = t.name.toLowerCase().includes(query);
      const idMatch = t.id.toLowerCase().includes(query);
      return nameMatch || idMatch;
    });
  }

  return filtered;
}

/**
 * Format template name for display in UI.
 * Removes template ID prefix if present and titlecases.
 */
export function formatTemplateDisplayName(template: StarterTemplate): string {
  // Return template's name field if available, otherwise derive from ID
  if (template.name) {
    return template.name;
  }

  // Fallback: format ID as display name
  let name = template.id;
  if (name.startsWith(STARTER_TEMPLATE_ID_PREFIX)) {
    name = name.slice(STARTER_TEMPLATE_ID_PREFIX.length);
  }

  // Replace underscores with spaces and titlecase
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// ─── Template Immutability Verification ───────────────────────────────────────

/**
 * Verify that a cloned plan is independent from its starter template.
 * After cloning, modifications to the cloned plan should not affect the original starter.
 */
export function isClonedIndependently(
  clonedPlanId: string,
  originalTemplateId: string
): boolean {
  // Cloned plans should have different IDs and cloned plans should NOT be starter templates
  return clonedPlanId !== originalTemplateId && !isStarterTemplate(clonedPlanId);
}

/**
 * Determine if a plan can be edited as a draft (i.e., is not a starter template).
 * Starter templates are immutable; only clones can be edited.
 */
export function isEditableAsDraft(planId: string): boolean {
  // Starter templates are read-only, cannot be edited directly
  // Only clones (non-starter plans) can be edited
  return !isStarterTemplate(planId);
}

// ─── Template Usage Tracking ────────────────────────────────────────────────────

/**
 * Track template usage statistics.
 * Useful for UX improvements and identifying popular templates.
 */
export type TemplateUsageStats = {
  templateId: string;
  cloneCount: number;
  assignmentCount: number;
};

/**
 * Increment clone count for a template.
 */
export function incrementTemplateCloneCount(
  stats: TemplateUsageStats,
  incrementBy: number = 1
): TemplateUsageStats {
  return {
    ...stats,
    cloneCount: stats.cloneCount + incrementBy,
  };
}

/**
 * Increment assignment count for a template (when a cloned plan is assigned).
 */
export function incrementTemplateAssignmentCount(
  stats: TemplateUsageStats,
  incrementBy: number = 1
): TemplateUsageStats {
  return {
    ...stats,
    assignmentCount: stats.assignmentCount + incrementBy,
  };
}
