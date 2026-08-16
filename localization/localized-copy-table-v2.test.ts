import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { enUS, type TranslationKey } from './en-US';
import { esES } from './es-ES';
import { ptBR } from './pt-BR';

const revenueCatHardeningChangedKeys = [
  'auth.terms.invalid_link',
  'common.value.unavailable',
  'custom_meal.image.permission_denied',
  'meal.photo_analysis.error.file_too_large',
  'meal.photo_analysis.error.permission_denied',
  'photo_picker.body',
  'photo_picker.choose_from_library',
  'photo_picker.take_photo',
  'photo_picker.title',
  'pro.home.all_caught_up_body',
  'pro.home.all_caught_up_title',
  'pro.home.attention_error',
  'pro.home.attention_loading',
  'pro.home.connection_requests',
  'pro.home.connection_requests_body',
  'pro.home.cta_nutrition',
  'pro.home.cta_training',
  'pro.home.invite_code.add_specialty',
  'pro.home.invite_code.specialty_required',
  'pro.home.manage',
  'pro.home.needs_attention',
  'pro.home.overview',
  'pro.home.subscription_status_unknown',
  'pro.home.subtitle',
  'pro.pending.count',
  'pro.pending.description',
  'pro.pending.title',
  'pro.subscription.capacity_title',
  'pro.subscription.cta_mobile_handoff',
  'pro.subscription.cta_unavailable',
  'pro.subscription.current_status',
  'pro.subscription.free_tier',
  'pro.subscription.handoff_note',
  'pro.subscription.locked_unknown',
  'pro.subscription.status.active_body',
  'pro.subscription.status.checking',
  'pro.subscription.status.inactive_body',
  'pro.subscription.status.unavailable_body',
  'pro.subscription.status.unknown',
  'pro.subscription.subtitle',
  'pro.subscription.unavailable_note',
  'student.home.error.connections',
  'student.home.error.hydration',
  'student.home.error.plans',
  'student.home.professionals_short',
  'student.home.summary',
  'student.home.welcome',
  'student.home.your_day',
] as const satisfies readonly TranslationKey[];

// ET-105: locked-state recovery copy must be capability-aware — it must
// never point at a purchase/restore/handoff control that isn't mounted.
const et105LockedRecoveryChangedKeys = [
  'pro.subscription.locked',
  'pro.subscription.locked_handoff',
  'pro.subscription.locked_unavailable',
] as const satisfies readonly TranslationKey[];

const localeBundles = {
  'en-US': enUS,
  'pt-BR': ptBR,
  'es-ES': esES,
} as const;

type CopyTableRow = {
  key: string;
  'en-US': string;
  'pt-BR': string;
  'es-ES': string;
};

function parseCopyTableRows(source: string): CopyTableRow[] {
  return source
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      const keyMatch = /^`([^`]+)`$/.exec(cells[0] ?? '');

      assert.ok(keyMatch, `copy-table row must start with a backticked localization key: ${line}`);
      assert.ok(cells.length >= 7, `copy-table row must contain all locale columns: ${line}`);

      return {
        key: keyMatch[1],
        'en-US': cells[3],
        'pt-BR': cells[4],
        'es-ES': cells[5],
      };
    });
}

test('RevenueCat-hardening localization changes stay documented in every supported locale', () => {
  const copyTableSource = readFileSync(
    join(process.cwd(), 'docs/screens/v2/localized-copy-table-v2.md'),
    'utf8',
  );
  const rows = parseCopyTableRows(copyTableSource);

  for (const key of revenueCatHardeningChangedKeys) {
    const matchingRows = rows.filter((row) => row.key === key);

    assert.equal(
      matchingRows.length,
      1,
      `${key} must appear exactly once in the localized copy table`,
    );

    const [row] = matchingRows;
    assert.ok(row);

    for (const locale of Object.keys(localeBundles) as (keyof typeof localeBundles)[]) {
      assert.equal(
        row[locale],
        localeBundles[locale][key],
        `${key} ${locale} copy must match its locale bundle`,
      );
    }
  }
});

test('ET-105 locked-state recovery copy stays documented and capability-distinct in every supported locale', () => {
  const copyTableSource = readFileSync(
    join(process.cwd(), 'docs/screens/v2/localized-copy-table-v2.md'),
    'utf8',
  );
  const rows = parseCopyTableRows(copyTableSource);

  for (const key of et105LockedRecoveryChangedKeys) {
    const matchingRows = rows.filter((row) => row.key === key);

    assert.equal(
      matchingRows.length,
      1,
      `${key} must appear exactly once in the localized copy table`,
    );

    const [row] = matchingRows;
    assert.ok(row);

    for (const locale of Object.keys(localeBundles) as (keyof typeof localeBundles)[]) {
      assert.equal(
        row[locale],
        localeBundles[locale][key],
        `${key} ${locale} copy must match its locale bundle`,
      );
    }
  }

  // The three capability variants must never share identical copy — otherwise
  // the locked card would fail to distinguish a mounted "continue on mobile"
  // CTA from no mounted control at all.
  for (const locale of Object.keys(localeBundles) as (keyof typeof localeBundles)[]) {
    const texts = et105LockedRecoveryChangedKeys.map((key) => localeBundles[locale][key]);
    assert.equal(
      new Set(texts).size,
      texts.length,
      `${locale} locked-state copy must differ across native_purchase/mobile_handoff/unavailable`,
    );
  }
});
