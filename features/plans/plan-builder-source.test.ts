/**
 * Unit tests for D-114 source helper logic extracted into plan-builder.logic.ts.
 *
 * Tests cover:
 *   - deriveStarterTemplatePlanType: prefix routing, edge cases, unknown prefixes
 *   - coalesceTemplateDescription: null/undefined coalescing, passthrough
 *
 * Strategy: test only pure functions (no Firebase / Expo dependencies) per the
 * established test-convention for this codebase. Source layer wiring (D-114)
 * relies on these helpers and on the StarterTemplateDeps injection pattern.
 *
 * Runner: node:test + node:assert/strict (npm run test:unit)
 * Refs: D-114, FR-247, BR-270, BR-295, TC-280
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveStarterTemplatePlanType,
  coalesceTemplateDescription,
} from './plan-builder.logic';

// ─── deriveStarterTemplatePlanType ────────────────────────────────────────────

describe('deriveStarterTemplatePlanType', () => {
  // --- Positive: nutrition prefix ---

  it('returns "nutrition" for starter_nutrition_ prefix', () => {
    assert.equal(deriveStarterTemplatePlanType('starter_nutrition_001'), 'nutrition');
  });

  it('returns "nutrition" for starter_nutrition_ with UUID suffix', () => {
    assert.equal(
      deriveStarterTemplatePlanType('starter_nutrition_e5b7c2d8-1a3f-4e9b-8c0d-7f2a1b3e4c5d'),
      'nutrition'
    );
  });

  it('returns "nutrition" for starter_nutrition_ with slug suffix', () => {
    assert.equal(deriveStarterTemplatePlanType('starter_nutrition_caloric_deficit_a'), 'nutrition');
  });

  // --- Positive: training prefix ---

  it('returns "training" for starter_training_ prefix', () => {
    assert.equal(deriveStarterTemplatePlanType('starter_training_001'), 'training');
  });

  it('returns "training" for starter_training_ with UUID suffix', () => {
    assert.equal(
      deriveStarterTemplatePlanType('starter_training_f1c2d3e4-5678-90ab-cdef-1234567890ab'),
      'training'
    );
  });

  it('returns "training" for starter_training_ with slug suffix', () => {
    assert.equal(deriveStarterTemplatePlanType('starter_training_full_body_beginner'), 'training');
  });

  // --- Negative: unrecognised prefixes ---

  it('returns null for empty string', () => {
    assert.equal(deriveStarterTemplatePlanType(''), null);
  });

  it('returns null for "starter_" without plan type qualifier', () => {
    assert.equal(deriveStarterTemplatePlanType('starter_'), null);
  });

  it('returns null for "starter_nutrition" without trailing underscore', () => {
    // Must have starter_nutrition_ (with trailing _) to match
    assert.equal(deriveStarterTemplatePlanType('starter_nutrition'), null);
  });

  it('returns null for "starter_training" without trailing underscore', () => {
    assert.equal(deriveStarterTemplatePlanType('starter_training'), null);
  });

  it('returns null for a plain user plan ID', () => {
    assert.equal(deriveStarterTemplatePlanType('my_plan_001'), null);
  });

  it('returns null for a UUID without prefix', () => {
    assert.equal(deriveStarterTemplatePlanType('e5b7c2d8-1a3f-4e9b-8c0d-7f2a1b3e4c5d'), null);
  });

  it('returns null for "nutrition" without starter prefix', () => {
    assert.equal(deriveStarterTemplatePlanType('nutrition_plan_001'), null);
  });

  it('returns null for "training" without starter prefix', () => {
    assert.equal(deriveStarterTemplatePlanType('training_plan_001'), null);
  });

  it('returns null for uppercase STARTER_NUTRITION_ (case-sensitive)', () => {
    assert.equal(deriveStarterTemplatePlanType('STARTER_NUTRITION_001'), null);
  });

  it('returns null for mixed-case Starter_nutrition_', () => {
    assert.equal(deriveStarterTemplatePlanType('Starter_nutrition_001'), null);
  });

  it('returns null for whitespace-only input', () => {
    assert.equal(deriveStarterTemplatePlanType('   '), null);
  });

  // --- Boundary: minimum valid IDs ---

  it('returns "nutrition" for starter_nutrition_ followed by a single char', () => {
    assert.equal(deriveStarterTemplatePlanType('starter_nutrition_a'), 'nutrition');
  });

  it('returns "training" for starter_training_ followed by a single char', () => {
    assert.equal(deriveStarterTemplatePlanType('starter_training_x'), 'training');
  });

  // --- Priority: nutrition checked first (relevant if string could match both) ---

  it('nutrition prefix takes priority when both prefixes could theoretically match', () => {
    // Constructed edge case: starts with starter_nutrition_ which is checked first
    const result = deriveStarterTemplatePlanType('starter_nutrition_starter_training_overlap');
    assert.equal(result, 'nutrition');
  });
});

// ─── coalesceTemplateDescription ─────────────────────────────────────────────

describe('coalesceTemplateDescription', () => {
  // --- null input ---

  it('returns undefined for null', () => {
    assert.equal(coalesceTemplateDescription(null), undefined);
  });

  // --- undefined input ---

  it('returns undefined for undefined', () => {
    assert.equal(coalesceTemplateDescription(undefined), undefined);
  });

  // --- passthrough for truthy strings ---

  it('returns the string unchanged for a non-empty description', () => {
    assert.equal(coalesceTemplateDescription('A simple cut plan'), 'A simple cut plan');
  });

  it('returns empty string unchanged (empty string is not null/undefined)', () => {
    assert.equal(coalesceTemplateDescription(''), '');
  });

  it('returns whitespace-only string unchanged', () => {
    assert.equal(coalesceTemplateDescription('   '), '   ');
  });

  it('returns Unicode description unchanged', () => {
    const desc = 'Plano básico de déficit calórico';
    assert.equal(coalesceTemplateDescription(desc), desc);
  });

  it('returns long description unchanged', () => {
    const desc = 'A'.repeat(500);
    assert.equal(coalesceTemplateDescription(desc), desc);
  });

  // --- type correctness ---

  it('result is undefined (not null) for null input', () => {
    const result = coalesceTemplateDescription(null);
    assert.equal(result, undefined);
    assert.notEqual(result, null);
  });

  it('result is undefined (not null) for undefined input', () => {
    const result = coalesceTemplateDescription(undefined);
    assert.equal(result, undefined);
    assert.notEqual(result, null);
  });
});
