/**
 * Unit tests for starter template logic (BL-006).
 * Covers template detection, cloning, filtering, and immutability verification.
 * Test count: 33 tests
 * Refs: FR-212, FR-247, AC-256, BR-270, TC-260, UC-002.14
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  isStarterTemplate,
  extractTemplateCategory,
  validateTemplateClone,
  canCloneTemplate,
  filterStarterTemplates,
  formatTemplateDisplayName,
  isClonedIndependently,
  isEditableAsDraft,
  incrementTemplateCloneCount,
  incrementTemplateAssignmentCount,
  type StarterTemplate,
  type TemplateCloneInput,
  type TemplateLibraryFilter,
  type TemplateUsageStats,
} from './starter-template.logic';

// ─── Template Detection Tests (4 tests) ────────────────────────────────────────

describe('isStarterTemplate()', () => {
  it('should return true for starter template IDs', () => {
    assert.equal(isStarterTemplate('starter_nutrition_basic'), true);
    assert.equal(isStarterTemplate('starter_training_full_body'), true);
  });

  it('should return false for non-starter template IDs', () => {
    assert.equal(isStarterTemplate('nutrition_basic'), false);
    assert.equal(isStarterTemplate('training_full_body'), false);
    assert.equal(isStarterTemplate('user_plan_123'), false);
    assert.equal(isStarterTemplate(''), false);
  });

  it('should handle edge cases for starter prefix', () => {
    assert.equal(isStarterTemplate('starter_'), true);
    assert.equal(isStarterTemplate('starter_a'), true);
    assert.equal(isStarterTemplate('astarterplan'), false);
  });

  it('should be case-sensitive for prefix', () => {
    assert.equal(isStarterTemplate('Starter_nutrition'), false);
    assert.equal(isStarterTemplate('STARTER_nutrition'), false);
  });
});

// ─── Category Extraction Tests (3 tests) ───────────────────────────────────────

describe('extractTemplateCategory()', () => {
  it('should extract nutrition and training categories', () => {
    assert.equal(extractTemplateCategory('starter_nutrition_basic'), 'nutrition');
    assert.equal(extractTemplateCategory('starter_training_full_body'), 'training');
    assert.equal(extractTemplateCategory('starter_nutrition_low_carb'), 'nutrition');
    assert.equal(extractTemplateCategory('starter_training_hiit'), 'training');
  });

  it('should return null for non-starter templates', () => {
    assert.equal(extractTemplateCategory('nutrition_basic'), null);
    assert.equal(extractTemplateCategory('training_plan'), null);
    assert.equal(extractTemplateCategory('user_plan_123'), null);
  });

  it('should return null for invalid category names', () => {
    assert.equal(extractTemplateCategory('starter_sport_soccer'), null);
    assert.equal(extractTemplateCategory('starter_invalid_category'), null);
    assert.equal(extractTemplateCategory('starter_'), null);
  });
});

// ─── Clone Validation Tests (6 tests) ──────────────────────────────────────────

describe('validateTemplateClone()', () => {
  it('should pass validation for valid inputs', () => {
    const input: TemplateCloneInput = {
      templateId: 'starter_nutrition_basic',
      newPlanName: 'My Custom Nutrition Plan',
    };
    const errors = validateTemplateClone(input);
    assert.deepEqual(errors, {});
  });

  it('should return templateId required error when empty', () => {
    const input: TemplateCloneInput = {
      templateId: '',
      newPlanName: 'My Plan',
    };
    const errors = validateTemplateClone(input);
    assert.equal(errors.templateId, 'required');
  });

  it('should return templateId invalid_format error for non-starter IDs', () => {
    const input: TemplateCloneInput = {
      templateId: 'my_custom_plan',
      newPlanName: 'Clone Name',
    };
    const errors = validateTemplateClone(input);
    assert.equal(errors.templateId, 'invalid_format');
  });

  it('should validate plan name requirements', () => {
    // Empty/whitespace-only name
    let errors = validateTemplateClone({
      templateId: 'starter_nutrition_basic',
      newPlanName: '   ',
    });
    assert.equal(errors.newPlanName, 'required');

    // Too short (less than 2 characters)
    errors = validateTemplateClone({
      templateId: 'starter_nutrition_basic',
      newPlanName: 'A',
    });
    assert.equal(errors.newPlanName, 'too_short');

    // Too long (over 100 characters)
    const longName = 'A'.repeat(101);
    errors = validateTemplateClone({
      templateId: 'starter_nutrition_basic',
      newPlanName: longName,
    });
    assert.equal(errors.newPlanName, 'too_long');
  });

  it('should handle multiple validation errors', () => {
    const input: TemplateCloneInput = {
      templateId: 'invalid_id',
      newPlanName: 'A',
    };
    const errors = validateTemplateClone(input);
    assert.equal(errors.templateId, 'invalid_format');
    assert.equal(errors.newPlanName, 'too_short');
  });

  it('should allow plan names with whitespace padding (trimmed internally)', () => {
    const errors = validateTemplateClone({
      templateId: 'starter_nutrition_basic',
      newPlanName: '  My Plan  ',
    });
    assert.deepEqual(errors, {});
  });
});

// ─── Library Filtering Tests (5 tests) ─────────────────────────────────────────

describe('filterStarterTemplates()', () => {
  const templates: StarterTemplate[] = [
    { id: 'starter_nutrition_basic', planType: 'nutrition', name: 'Basic Nutrition' },
    { id: 'starter_nutrition_low_carb', planType: 'nutrition', name: 'Low Carb Nutrition' },
    { id: 'starter_training_full_body', planType: 'training', name: 'Full Body Training' },
    { id: 'starter_training_hiit', planType: 'training', name: 'HIIT Training' },
  ];

  it('should return all templates when no filter applied', () => {
    const result = filterStarterTemplates(templates, {});
    assert.equal(result.length, 4);
  });

  it('should filter templates by plan type', () => {
    let result = filterStarterTemplates(templates, { planType: 'nutrition' });
    assert.equal(result.length, 2);
    assert.ok(result.every((t) => t.planType === 'nutrition'));

    result = filterStarterTemplates(templates, { planType: 'training' });
    assert.equal(result.length, 2);
    assert.ok(result.every((t) => t.planType === 'training'));
  });

  it('should filter templates by search query (case-insensitive)', () => {
    let result = filterStarterTemplates(templates, { searchQuery: 'nutrition' });
    assert.equal(result.length, 2);
    assert.ok(result.every((t) => t.planType === 'nutrition'));

    result = filterStarterTemplates(templates, { searchQuery: 'HIIT' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'starter_training_hiit');

    result = filterStarterTemplates(templates, { searchQuery: 'training' });
    assert.equal(result.length, 2);
  });

  it('should filter by both plan type and search query', () => {
    const result = filterStarterTemplates(templates, {
      planType: 'nutrition',
      searchQuery: 'low',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'starter_nutrition_low_carb');
  });

  it('should return empty array when no matches found', () => {
    const result = filterStarterTemplates(templates, { searchQuery: 'nonexistent' });
    assert.equal(result.length, 0);
  });
});

// ─── Display Name Formatting Tests (3 tests) ───────────────────────────────────

describe('formatTemplateDisplayName()', () => {
  it('should use template name field when provided', () => {
    const template: StarterTemplate = {
      id: 'starter_nutrition_basic',
      planType: 'nutrition',
      name: 'Basic Nutrition Plan',
    };
    assert.equal(formatTemplateDisplayName(template), 'Basic Nutrition Plan');
  });

  it('should format ID-derived names with titlecase and spaces', () => {
    const template: StarterTemplate = {
      id: 'starter_nutrition_low_carb',
      planType: 'nutrition',
      name: '',
    };
    assert.equal(formatTemplateDisplayName(template), 'Nutrition Low Carb');
  });

  it('should handle edge cases in name formatting', () => {
    const template1: StarterTemplate = {
      id: 'starter_a',
      planType: 'nutrition',
      name: '',
    };
    assert.equal(formatTemplateDisplayName(template1), 'A');

    const template2: StarterTemplate = {
      id: 'starter_training_full_body_advanced',
      planType: 'training',
      name: '',
    };
    assert.equal(formatTemplateDisplayName(template2), 'Training Full Body Advanced');
  });
});

// ─── Clone Independence Verification Tests (3 tests) ────────────────────────────

describe('isClonedIndependently()', () => {
  it('should verify that cloned plan is independent from original template', () => {
    assert.equal(
      isClonedIndependently('user_plan_abc123', 'starter_nutrition_basic'),
      true
    );
    assert.equal(
      isClonedIndependently('cloned_plan_xyz', 'starter_training_full_body'),
      true
    );
  });

  it('should return false if cloned plan has same ID as original', () => {
    assert.equal(
      isClonedIndependently('starter_nutrition_basic', 'starter_nutrition_basic'),
      false
    );
  });

  it('should return false if cloned plan is itself a starter template', () => {
    assert.equal(
      isClonedIndependently('starter_nutrition_custom', 'starter_nutrition_basic'),
      false
    );
  });
});

// ─── Editability Checks Tests (2 tests) ────────────────────────────────────────

describe('isEditableAsDraft()', () => {
  it('should return false for starter template IDs (immutable)', () => {
    assert.equal(isEditableAsDraft('starter_nutrition_basic'), false);
    assert.equal(isEditableAsDraft('starter_training_full_body'), false);
  });

  it('should return true for non-starter plan IDs (clones, editable)', () => {
    assert.equal(isEditableAsDraft('user_plan_abc123'), true);
    assert.equal(isEditableAsDraft('cloned_nutrition_plan'), true);
    assert.equal(isEditableAsDraft('my_custom_training'), true);
  });
});

// ─── Usage Tracking Tests (2 tests) ────────────────────────────────────────────

describe('incrementTemplateCloneCount()', () => {
  it('should increment clone count by specified amount', () => {
    const stats: TemplateUsageStats = {
      templateId: 'starter_nutrition_basic',
      cloneCount: 5,
      assignmentCount: 3,
    };

    const result = incrementTemplateCloneCount(stats, 2);
    assert.equal(result.cloneCount, 7);
    assert.equal(result.assignmentCount, 3); // Unchanged
    assert.equal(result.templateId, 'starter_nutrition_basic');
  });

  it('should increment by 1 when no amount specified', () => {
    const stats: TemplateUsageStats = {
      templateId: 'starter_training_hiit',
      cloneCount: 10,
      assignmentCount: 8,
    };

    const result = incrementTemplateCloneCount(stats);
    assert.equal(result.cloneCount, 11);
    assert.equal(result.assignmentCount, 8);
  });
});

describe('incrementTemplateAssignmentCount()', () => {
  it('should increment assignment count by specified amount', () => {
    const stats: TemplateUsageStats = {
      templateId: 'starter_nutrition_basic',
      cloneCount: 5,
      assignmentCount: 3,
    };

    const result = incrementTemplateAssignmentCount(stats, 3);
    assert.equal(result.assignmentCount, 6);
    assert.equal(result.cloneCount, 5); // Unchanged
    assert.equal(result.templateId, 'starter_nutrition_basic');
  });

  it('should increment by 1 when no amount specified', () => {
    const stats: TemplateUsageStats = {
      templateId: 'starter_training_full_body',
      cloneCount: 20,
      assignmentCount: 15,
    };

    const result = incrementTemplateAssignmentCount(stats);
    assert.equal(result.assignmentCount, 16);
    assert.equal(result.cloneCount, 20);
  });
});

// ─── Edge Cases & Integration Tests (5 tests) ──────────────────────────────────

describe('Edge cases and integration scenarios', () => {
  it('should handle complete clone workflow validation', () => {
    const input: TemplateCloneInput = {
      templateId: 'starter_nutrition_basic',
      newPlanName: 'My Custom Plan',
    };

    const errors = validateTemplateClone(input);
    const canProceed = canCloneTemplate(errors);
    assert.equal(canProceed, true);

    // Verify template is independently cloned
    const clonedId = 'user_plan_new_123';
    const isIndependent = isClonedIndependently(clonedId, input.templateId);
    assert.equal(isIndependent, true);

    // Verify cloned plan is editable
    const isEditable = isEditableAsDraft(clonedId);
    assert.equal(isEditable, true);

    // Verify original template is not editable
    const templateEditable = isEditableAsDraft(input.templateId);
    assert.equal(templateEditable, false);
  });

  it('should handle failed clone workflow validation', () => {
    const input: TemplateCloneInput = {
      templateId: 'my_plan_id',
      newPlanName: 'X',
    };

    const errors = validateTemplateClone(input);
    const canProceed = canCloneTemplate(errors);
    assert.equal(canProceed, false);
    assert.equal(errors.templateId, 'invalid_format');
    assert.equal(errors.newPlanName, 'too_short');
  });

  it('should handle filtering with empty template list', () => {
    const result = filterStarterTemplates([], {
      planType: 'nutrition',
      searchQuery: 'test',
    });
    assert.equal(result.length, 0);
  });

  it('should preserve immutability in usage tracking', () => {
    const original: TemplateUsageStats = {
      templateId: 'starter_nutrition_basic',
      cloneCount: 5,
      assignmentCount: 3,
    };

    const updated1 = incrementTemplateCloneCount(original, 2);
    const updated2 = incrementTemplateAssignmentCount(original, 1);

    // Original should not be mutated
    assert.equal(original.cloneCount, 5);
    assert.equal(original.assignmentCount, 3);

    // Updates should be independent
    assert.equal(updated1.cloneCount, 7);
    assert.equal(updated1.assignmentCount, 3);
    assert.equal(updated2.cloneCount, 5);
    assert.equal(updated2.assignmentCount, 4);
  });

  it('should handle template category extraction across various ID formats', () => {
    // Valid categories with various suffixes
    assert.equal(extractTemplateCategory('starter_nutrition_basic'), 'nutrition');
    assert.equal(extractTemplateCategory('starter_nutrition_'), 'nutrition');
    assert.equal(extractTemplateCategory('starter_training'), 'training');

    // Invalid but prefix-valid starter IDs
    assert.equal(extractTemplateCategory('starter_wellness_holistic'), null);
    assert.equal(extractTemplateCategory('starter_coaching_agile'), null);

    // Non-starter IDs
    assert.equal(extractTemplateCategory('user_nutrition_plan'), null);
  });
});
