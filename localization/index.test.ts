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

test('SC-206 Locale: tracking review numeric templates resolve in all locales', () => {
  assert.equal(
    t('en-US', 'pro.student_profile.tracking_review.water_progress_value', {
      total: 500,
      goal: 2000,
      percent: 25,
    }),
    '500/2000 ml (25%)'
  );
  assert.equal(
    t('pt-BR', 'pro.student_profile.tracking_review.water_total_value', { total: 500 }),
    '500 ml'
  );
  assert.equal(
    t('es-ES', 'pro.student_profile.tracking_review.portion_macros_value', {
      calories: 320,
      carbs: 40,
      proteins: 20,
      fats: 8,
    }),
    '320 kcal · 40 g carb. · 20 g prot. · 8 g grasa'
  );
});

test('SC-207 Locale: meal builder fallback copy resolves in all locales', () => {
  assert.equal(t('en-US', 'pro.plan.error.reason', { reason: 'network' }), 'Reason: network');
  assert.equal(t('pt-BR', 'pro.plan.meal.not_found'), 'Refeição não encontrada');
  assert.equal(t('es-ES', 'pro.plan.meal.go_back'), 'Volver');
});

test('SC-206 Locale: assignment draft controls resolve in all locales', () => {
  assert.equal(t('en-US', 'pro.student_profile.assignment.draft_pending'), 'Draft pending send');
  assert.equal(t('pt-BR', 'pro.student_profile.assignment.cta_resume_draft'), 'Retomar rascunho');
  assert.equal(t('es-ES', 'pro.student_profile.assignment.cta_view_edit'), 'Ver/editar plan asignado');
  assert.equal(t('en-US', 'pro.plan.discard.success'), 'Draft discarded successfully.');
  assert.equal(t('pt-BR', 'pro.plan.discard.error'), 'Não foi possível descartar o rascunho.');
});
