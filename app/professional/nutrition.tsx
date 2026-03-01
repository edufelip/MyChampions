/**
 * Professional Nutrition Library — SC-207 tab entry screen
 * Route: /professional/nutrition
 *
 * Displays the professional's predefined nutrition plan library.
 * Tapping a plan navigates to /professional/nutrition/plans/:planId.
 * Creating a new plan navigates to /professional/nutrition/plans/new.
 *
 * Data Connect predefined plan library wiring is deferred (stub returns empty
 * until endpoint is live via usePlans hook).
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-207-nutrition-plan-builder.md
 * Refs: D-080, D-111, FR-109, FR-110, FR-223, FR-240,
 *       BR-281, TC-268, TC-275
 */
import { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { usePlans } from '@/features/plans/use-plans';
import type { PredefinedPlan } from '@/features/plans/plan-source';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProNutritionLibraryScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { state, reload } = usePlans(currentUser);

  const nutritionPlans: PredefinedPlan[] =
    state.kind === 'ready'
      ? state.predefinedPlans.filter((p) => p.planType === 'nutrition')
      : [];

  const renderItem = useCallback(
    ({ item }: { item: PredefinedPlan }) => (
      <PlanRow
        plan={item}
        palette={palette}
        t={t}
        onPress={() => router.push(`/professional/nutrition/plans/${item.id}`)}
      />
    ),
    [palette, router, t]
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ title: t('pro.library.nutrition.title'), headerShown: true }} />

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {state.kind === 'loading' && (
        <ActivityIndicator
          style={styles.loader}
          accessibilityLabel={t('a11y.loading.default')}
        />
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {state.kind === 'error' && (
        <View style={styles.centeredContent}>
          <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={[styles.errorText, { color: palette.icon }]}>
              {t('pro.library.error')}
            </Text>
          </View>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: palette.tint }]}
            onPress={reload}
            accessibilityRole="button"
            accessibilityLabel={t('common.error.generic')}
          >
            <Text style={[styles.primaryBtnText, { color: palette.background }]}>
              {t('common.error.generic')}
            </Text>
          </Pressable>
        </View>
      )}

      {/* ── Plan list ────────────────────────────────────────────────────── */}
      {state.kind === 'ready' && (
        <FlatList
          data={nutritionPlans}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState palette={palette} t={t} />
          }
          renderItem={renderItem}
          ListFooterComponent={
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: palette.tint }]}
              onPress={() => router.push('/professional/nutrition/plans/new')}
              accessibilityRole="button"
              accessibilityLabel={t('pro.library.nutrition.cta_create')}
            >
              <Text style={[styles.primaryBtnText, { color: palette.background }]}>
                {t('pro.library.nutrition.cta_create')}
              </Text>
            </Pressable>
          }
        />
      )}
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState({ palette, t }: { palette: Palette; t: TFn }) {
  return (
    <View style={styles.emptyState}>
      <Text style={[styles.emptyText, { color: palette.icon }]}>
        {t('pro.library.nutrition.empty')}
      </Text>
    </View>
  );
}

type PlanRowProps = {
  plan: PredefinedPlan;
  palette: Palette;
  t: TFn;
  onPress: () => void;
};

function PlanRow({ plan, palette, t, onPress }: PlanRowProps) {
  return (
    <Pressable
      style={[styles.planRow, { borderColor: palette.icon }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${plan.name}, ${t('pro.plan.predefined.label')}`}
    >
      <View style={styles.planInfo}>
        <Text style={[styles.planName, { color: palette.text }]}>{plan.name}</Text>
        <Text style={[styles.planMeta, { color: palette.icon }]}>
          {t('pro.plan.predefined.label')}
        </Text>
      </View>
      <Text style={[styles.openCta, { color: palette.tint }]}>{t('pro.library.cta_open')}</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  loader: { marginVertical: 32 },
  centeredContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  errorText: { fontSize: 14, textAlign: 'center' },
  listContent: { padding: 16, gap: 10, paddingBottom: 40 },
  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  planInfo: { flex: 1, gap: 2 },
  planName: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 15,
    fontWeight: '700',
  },
  planMeta: { fontSize: 12 },
  openCta: { fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700' },
});
