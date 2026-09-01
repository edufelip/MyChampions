import assert from 'node:assert/strict';
import test from 'node:test';
import { formatQuantityWithUnit } from './food-item-quantity';

test('formatQuantityWithUnit appends "g" to a bare numeric gram amount', () => {
  assert.equal(formatQuantityWithUnit('150'), '150g');
  assert.equal(formatQuantityWithUnit('100'), '100g');
  assert.equal(formatQuantityWithUnit('12.5'), '12.5g');
});

test('formatQuantityWithUnit does not mangle a quantity that already carries a unit (ET-166)', () => {
  // Regression for ET-166: "1 bowl" + naive "g" suffix rendered as "1 bowlg".
  assert.equal(formatQuantityWithUnit('1 bowl'), '1 bowl');
  assert.equal(formatQuantityWithUnit('1 medium'), '1 medium');
});

test('formatQuantityWithUnit does not double up a quantity that is already gram-formatted', () => {
  // Custom-meal snapshots already format quantity as "350g" (see
  // buildNutritionMealItemInputFromCustomMealSnapshot); it must not become "350gg".
  assert.equal(formatQuantityWithUnit('350g'), '350g');
});

test('formatQuantityWithUnit trims whitespace and returns empty string for blank input', () => {
  assert.equal(formatQuantityWithUnit('  200  '), '200g');
  assert.equal(formatQuantityWithUnit(''), '');
  assert.equal(formatQuantityWithUnit('   '), '');
});
