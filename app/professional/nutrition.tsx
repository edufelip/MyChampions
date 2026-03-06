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
 * Refs: D-080, D-111, D-134, FR-109, FR-110, FR-223, FR-240,
 *       BR-281, TC-268, TC-275
 */
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import type { PredefinedPlan } from '@/features/plans/plan-source';
import { usePlans } from '@/features/plans/use-plans';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

type TFn = ReturnType<typeof useTranslation>['t'];

export default function ProNutritionLibraryScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { state, reload } = usePlans(Boolean(currentUser));

  const nutritionPlans: PredefinedPlan[] =
    state.kind === 'ready' ? state.predefinedPlans.filter((p) => p.planType === 'nutrition') : [];

  const renderItem = useCallback(
    ({ item }: { item: PredefinedPlan }) => (
      <PlanRow
        plan={item}
        theme={theme}
        t={t}
        onPress={() => router.push(`/professional/nutrition/plans/${item.id}`)}
      />
    ),
    [router, t, theme]
  );

  return (
    <DsScreen scheme={scheme} scrollable={false} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('pro.library.nutrition.title'), headerShown: false }} />

      {state.kind === 'loading' ? (
        <ActivityIndicator
          style={styles.loader}
          accessibilityLabel={t('a11y.loading.default')}
          color={theme.color.accentPrimary}
        />
      ) : null}

      {state.kind === 'error' ? (
        <DsCard scheme={scheme} style={styles.centeredContent}>
          <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={[styles.errorText, { color: theme.color.textSecondary }]}>{t('pro.library.error')}</Text>
          </View>
          <DsPillButton
            scheme={scheme}
            onPress={reload}
            label={t('common.error.retry') as string}
            testID="pro.library.retry"
          />
        </DsCard>
      ) : null}

      {state.kind === 'ready' ? (
        <FlatList
          data={nutritionPlans}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<EmptyState theme={theme} t={t} scheme={scheme} />}
          renderItem={renderItem}
          ListFooterComponent={
            <DsPillButton
              scheme={scheme}
              label={t('pro.library.nutrition.cta_create') as string}
              onPress={() => router.push('/professional/nutrition/plans/new')}
              testID="pro.library.nutrition.create"
            />
          }
        />
      ) : null}
    </DsScreen>
  );
}

function EmptyState({
  scheme,
  theme,
  t,
}: {
  scheme: 'light' | 'dark';
  theme: ReturnType<typeof getDsTheme>;
  t: TFn;
}) {
  return (
    <DsCard scheme={scheme} variant="muted" style={styles.emptyState}>
      <Text style={[styles.emptyText, { color: theme.color.textSecondary }]}>{t('pro.library.nutrition.empty')}</Text>
    </DsCard>
  );
}

type PlanRowProps = {
  plan: PredefinedPlan;
  theme: ReturnType<typeof getDsTheme>;
  t: TFn;
  onPress: () => void;
};

function PlanRow({ plan, theme, t, onPress }: PlanRowProps) {
  return (
    <Pressable
      style={[styles.planRow, { borderColor: theme.color.border, backgroundColor: theme.color.surface }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${plan.name}, ${t('pro.plan.predefined.label')}`}>
      <View style={styles.planInfo}>
        <Text style={[styles.planName, { color: theme.color.textPrimary }]}>{plan.name}</Text>
        <Text style={[styles.planMeta, { color: theme.color.textSecondary }]}>{t('pro.plan.predefined.label')}</Text>
      </View>
      <Text style={[styles.openCta, { color: theme.color.accentPrimary }]}>{t('pro.library.cta_open')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: DsSpace.lg,
    paddingBottom: DsSpace.xxl,
  },
  loader: {
    marginVertical: 32,
  },
  centeredContent: {
    alignItems: 'center',
    gap: DsSpace.md,
    justifyContent: 'center',
    padding: DsSpace.lg,
  },
  errorText: {
    ...DsTypography.body,
    textAlign: 'center',
  },
  listContent: {
    gap: DsSpace.sm,
    paddingBottom: DsSpace.xl,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    ...DsTypography.body,
    textAlign: 'center',
  },
  planRow: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: DsSpace.sm,
    padding: 14,
  },
  planInfo: { flex: 1, gap: 2 },
  planName: {
    ...DsTypography.body,
    fontFamily: Fonts?.rounded ?? 'normal',
    fontWeight: '700',
  },
  planMeta: { ...DsTypography.caption },
  openCta: { ...DsTypography.caption, fontWeight: '700' },
});
