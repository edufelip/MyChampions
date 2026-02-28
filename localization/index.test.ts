import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLocale, t } from './index';

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
  assert.equal(t('en-US', 'auth.signin.cta_primary'), 'Sign in');
  assert.equal(t('pt-BR', 'auth.signin.cta_primary'), 'Entrar');
  assert.equal(t('es-ES', 'auth.signin.cta_primary'), 'Iniciar sesión');
});

test('t interpolates params', () => {
  assert.equal(t('en-US', 'student.hydration.progress', { consumed: 500, goal: 2000 }), '500 / 2000 ml');
});
