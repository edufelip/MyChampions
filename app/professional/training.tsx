/**
 * Professional Training Library — SC-208 tab entry screen
 * Route: /professional/training
 *
 * Displays the professional's predefined training plan library.
 * Tapping a plan navigates to /professional/training/plans/:planId.
 * Creating a new plan navigates to /professional/training/plans/new.
 *
 * Data wiring is Firestore-backed via usePlans hook.
 *
 * Docs: docs/screens/v2/SC-208-training-plan-builder.md
 * Refs: D-013, D-080, D-111, D-134, FR-111, FR-112, FR-223, FR-244,
 *       BR-224, BR-281, TC-268, TC-278
 */
import { useCallback } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsRadius, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import type { PredefinedPlan } from '@/features/plans/plan-source';
import { usePlans } from '@/features/plans/use-plans';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

type TFn = ReturnType<typeof useTranslation>['t'];

export default function ProTrainingLibraryScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { state, reload } = usePlans(Boolean(currentUser));

  const trainingPlans: PredefinedPlan[] =
    state.kind === 'ready' ? state.predefinedPlans.filter((p) => p.planType === 'training') : [];

  const renderItem = useCallback(
    ({ item }: { item: PredefinedPlan }) => (
      <PlanRow
        plan={item}
        theme={theme}
        t={t}
        onPress={() => router.push(`/professional/training/plans/${item.id}`)}
      />
    ),
    [router, t, theme]
  );

  return (
    <DsScreen scheme={scheme} scrollable={false} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('pro.library.training.title'), headerShown: false }} />

      <DsCard scheme={scheme} style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View
            style={[
              styles.heroIconWrap,
              {
                backgroundColor: theme.color.accentPrimarySoft,
                borderColor: theme.color.accentPrimary,
              },
            ]}>
            <MaterialIcons name="fitness-center" size={20} color={theme.color.accentPrimary} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={[styles.screenTitle, { color: theme.color.textPrimary }]}>
              {t('pro.library.training.title')}
            </Text>
            <Text style={[styles.screenSubtitle, { color: theme.color.textSecondary }]}>
              {t('pro.predefined_plan.copy_independent_note')}
            </Text>
          </View>
        </View>
      </DsCard>

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
        <DsCard scheme={scheme} style={styles.listCard}>
          <FlatList
            data={trainingPlans}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[
              styles.listContent,
              trainingPlans.length === 0 && { flexGrow: 1, justifyContent: 'center' },
            ]}
            ListEmptyComponent={<EmptyState theme={theme} t={t} scheme={scheme} />}
            renderItem={renderItem}
            ListFooterComponent={
              <DsPillButton
                scheme={scheme}
                label={t('pro.library.training.cta_create') as string}
                onPress={() => router.push('/professional/training/plans/new')}
                testID="pro.library.training.create"
              />
            }
          />
        </DsCard>
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
      <View style={styles.emptyHeroWrap}>
        <View
          style={[
            styles.emptyHeroGlow,
            { backgroundColor: theme.color.accentPrimarySoft, borderColor: theme.color.accentPrimarySoft },
          ]}
        />
        <View
          style={[
            styles.emptyIconWrap,
            {
              backgroundColor: theme.color.surface,
              borderColor: theme.color.border,
            },
          ]}>
          <MaterialIcons name="fitness-center" size={34} color={theme.color.accentPrimary} />
          <View style={styles.emptyHeroDots}>
            <View style={[styles.emptyHeroDot, { backgroundColor: theme.color.accentPrimarySoft }]} />
            <View style={[styles.emptyHeroDot, { backgroundColor: theme.color.accentPrimary }]} />
            <View style={[styles.emptyHeroDot, { backgroundColor: theme.color.accentBlueSoft }]} />
          </View>
        </View>
      </View>
      <Text style={[styles.emptyText, { color: theme.color.textSecondary }]}>
        {t('pro.library.training.empty')}
      </Text>
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
      <View style={[styles.rowIconWrap, { backgroundColor: theme.color.accentBlueSoft }]}>
        <MaterialIcons name="fitness-center" size={18} color={theme.color.accentPrimary} />
      </View>
      <View style={styles.planInfo}>
        <Text style={[styles.planName, { color: theme.color.textPrimary }]}>{plan.name}</Text>
        <Text style={[styles.planMeta, { color: theme.color.textSecondary }]}>{t('pro.plan.predefined.label')}</Text>
      </View>
      <View style={[styles.openPill, { backgroundColor: theme.color.accentPrimarySoft }]}>
        <Text style={[styles.openCta, { color: theme.color.accentPrimary }]}>{t('pro.library.cta_open')}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={20} color={theme.color.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: DsSpace.md,
    paddingBottom: DsSpace.xxl,
    paddingHorizontal: DsSpace.lg,
    paddingTop: DsSpace.lg,
  },
  heroCard: {
    borderRadius: DsRadius.xl,
    padding: DsSpace.md,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  heroIconWrap: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  heroCopy: {
    flex: 1,
    gap: 2,
  },
  screenTitle: {
    ...DsTypography.title,
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 24,
    lineHeight: 30,
  },
  screenSubtitle: {
    ...DsTypography.caption,
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
  listCard: {
    borderRadius: DsRadius.xl,
    flex: 1,
    padding: DsSpace.md,
  },
  listContent: {
    gap: DsSpace.sm,
    paddingBottom: DsSpace.xl,
  },
  emptyState: {
    alignItems: 'center',
    borderRadius: DsRadius.xl,
    gap: DsSpace.sm,
    paddingVertical: DsSpace.xl,
  },
  emptyHeroWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: DsSpace.xs,
    position: 'relative',
  },
  emptyHeroGlow: {
    borderRadius: DsRadius.pill,
    borderWidth: 1,
    height: 144,
    opacity: 0.9,
    position: 'absolute',
    width: 144,
  },
  emptyIconWrap: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    borderWidth: 1,
    height: 112,
    justifyContent: 'center',
    width: 112,
  },
  emptyHeroDots: {
    flexDirection: 'row',
    gap: DsSpace.xs,
    marginTop: DsSpace.xs,
  },
  emptyHeroDot: {
    borderRadius: DsRadius.pill,
    height: 6,
    width: 6,
  },
  emptyText: {
    ...DsTypography.body,
    textAlign: 'center',
  },
  planRow: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: DsSpace.sm,
    padding: 14,
  },
  rowIconWrap: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  planInfo: { flex: 1, gap: 2 },
  planName: {
    ...DsTypography.body,
    fontFamily: Fonts?.rounded ?? 'normal',
    fontWeight: '700',
  },
  planMeta: { ...DsTypography.caption },
  openPill: {
    borderRadius: DsRadius.pill,
    paddingHorizontal: DsSpace.sm,
    paddingVertical: 4,
  },
  openCta: { ...DsTypography.caption, fontWeight: '700' },
});
