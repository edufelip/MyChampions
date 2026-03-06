import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import type { usePlans } from '@/features/plans/use-plans';
import type { useTranslation } from '@/localization';

type TFn = ReturnType<typeof useTranslation>['t'];

export function PlanPickerModal({
  isVisible,
  onClose,
  onSelect,
  plansState,
  planType,
  scheme,
  theme,
  t,
}: {
  isVisible: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  plansState: ReturnType<typeof usePlans>['state'];
  planType?: 'nutrition' | 'training';
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
}) {
  const filteredPlans =
    plansState.kind === 'ready'
      ? plansState.predefinedPlans.filter((p) => (planType ? p.planType === planType : true))
      : [];

  return (
    <Modal visible={isVisible} animationType="slide" transparent>
      <View style={[styles.modalOverlay, { backgroundColor: theme.color.overlaySoft }]}>
        <View style={[styles.modalContent, { backgroundColor: theme.color.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.color.textPrimary }]}>
              {t('pro.plan.picker.title')}
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: theme.color.accentPrimary, fontWeight: '600' }}>
                {t('auth.role.cta_back')}
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalScroll}>
            {plansState.kind === 'loading' && (
              <ActivityIndicator color={theme.color.accentPrimary} style={{ marginTop: 20 }} />
            )}

            {plansState.kind === 'ready' && filteredPlans.length === 0 && (
              <Text style={[styles.emptyText, { color: theme.color.textSecondary, textAlign: 'center', marginTop: 20 }]}>
                {t('pro.plan.picker.empty')}
              </Text>
            )}

            {plansState.kind === 'ready' &&
              filteredPlans.map((plan) => (
                <Pressable
                  key={plan.id}
                  style={[styles.planRowModal, { borderColor: theme.color.border }]}
                  onPress={() => onSelect(plan.id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planNameModal, { color: theme.color.textPrimary }]}>
                      {plan.name}
                    </Text>
                    {!planType && (
                      <Text style={{ fontSize: 12, color: theme.color.textSecondary, textTransform: 'capitalize' }}>
                        {plan.planType}
                      </Text>
                    )}
                  </View>
                  <DsPillButton
                    scheme={scheme}
                    label={t('pro.plan.picker.cta_assign') as string}
                    onPress={() => onSelect(plan.id)}
                    size="xs"
                    fullWidth={false}
                  />
                </Pressable>
              ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: DsRadius.xl,
    borderTopRightRadius: DsRadius.xl,
    minHeight: '50%',
    maxHeight: '85%',
    padding: DsSpace.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: DsSpace.md,
  },
  modalTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  modalScroll: { gap: DsSpace.md, paddingBottom: 40 },
  planRowModal: {
    borderWidth: 1,
    borderRadius: DsRadius.lg,
    padding: DsSpace.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DsSpace.sm,
  },
  planNameModal: { fontWeight: '700', fontSize: 15 },
  emptyText: {
    ...DsTypography.body,
    padding: DsSpace.xxl,
    textAlign: 'center',
  },
});
