import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTranslationBinding, resolveLocale, t } from './index';

test('resolveLocale maps exact supported locale', () => {
  assert.equal(resolveLocale('pt-BR'), 'pt-BR');
});

test('resolveLocale maps language variants to supported locale', () => {
  assert.equal(resolveLocale('es-MX'), 'es-ES');
  assert.equal(resolveLocale('pt-PT'), 'pt-BR');
});

test('resolveLocale falls back to en-US', () => {
  assert.equal(resolveLocale('fr-FR'), 'en-US');
});

test('t returns localized value for key', () => {
  assert.equal(t('en-US', 'auth.signin.cta_primary'), 'Sign In');
  assert.equal(t('pt-BR', 'auth.signin.cta_primary'), 'Entrar');
  assert.equal(t('es-ES', 'auth.signin.cta_primary'), 'Iniciar sesión');
});

test('t interpolates params', () => {
  assert.equal(t('en-US', 'student.hydration.progress', { consumed: 500, goal: 2000 }), '500 / 2000 ml');
});

test('buildTranslationBinding keeps same t reference for same locale', () => {
  const first = buildTranslationBinding('en-US');
  const second = buildTranslationBinding('en-US', first);
  assert.equal(first.t, second.t);
});

test('buildTranslationBinding creates new t reference when locale changes', () => {
  const first = buildTranslationBinding('en-US');
  const second = buildTranslationBinding('pt-BR', first);
  assert.notEqual(first.t, second.t);
});

// ─── BL-011: dismiss key presence and correct copy in all locale bundles ───────

test('BL-011 Locale: pro.specialty.remove_blocked.dismiss resolves in all locales', () => {
  assert.equal(t('en-US', 'pro.specialty.remove_blocked.dismiss'), 'Dismiss');
  assert.equal(t('pt-BR', 'pro.specialty.remove_blocked.dismiss'), 'Dispensar');
  assert.equal(t('es-ES', 'pro.specialty.remove_blocked.dismiss'), 'Descartar');
});
