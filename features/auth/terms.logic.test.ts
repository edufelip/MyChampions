import assert from 'node:assert/strict';
import test from 'node:test';

import {
  needsTermsAcceptance,
  normalizeTermsVersion,
  resolveRequiredTermsVersion,
  resolveTermsUrl,
} from './terms.logic';

test('normalizeTermsVersion trims and normalizes empty values', () => {
  assert.equal(normalizeTermsVersion(' v2 '), 'v2');
  assert.equal(normalizeTermsVersion(''), null);
  assert.equal(normalizeTermsVersion('   '), null);
  assert.equal(normalizeTermsVersion(null), null);
});

test('resolveRequiredTermsVersion falls back to v1 by default', () => {
  assert.equal(resolveRequiredTermsVersion('v3'), 'v3');
  assert.equal(resolveRequiredTermsVersion('  v3  '), 'v3');
  assert.equal(resolveRequiredTermsVersion(''), 'v1');
});

test('resolveTermsUrl falls back to google.com when missing', () => {
  assert.equal(resolveTermsUrl('https://example.com/terms'), 'https://example.com/terms');
  assert.equal(resolveTermsUrl('   '), 'https://google.com');
  assert.equal(resolveTermsUrl(null), 'https://google.com');
});

test('needsTermsAcceptance returns true only when required differs from accepted', () => {
  assert.equal(needsTermsAcceptance({ requiredVersion: 'v1', acceptedVersion: 'v1' }), false);
  assert.equal(needsTermsAcceptance({ requiredVersion: 'v2', acceptedVersion: 'v1' }), true);
  assert.equal(needsTermsAcceptance({ requiredVersion: 'v1', acceptedVersion: null }), true);
  assert.equal(needsTermsAcceptance({ requiredVersion: '', acceptedVersion: null }), false);
});
