import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import type { usePlans } from '@/features/plans/use-plans';
import type { useTranslation } from '@/localization';
import { useWebDialogAccessibility } from '@/hooks/use-web-dialog-accessibility';

type TFn = ReturnType<typeof useTranslation>['t'];

export function PlanPickerModal({
  isVisible,
  onClose,
  onSelect,
  plansState,
  planType,
  theme,
  t,
}: {
  isVisible: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  plansState: ReturnType<typeof usePlans>['state'];
  planType?: 'nutrition' | 'training';
  theme: DsTheme;
  t: TFn;
}) {
  const [isPresented, setIsPresented] = useState(false);

  useEffect(() => {
    if (!isVisible) {
      setIsPresented(false);
    }
  }, [isVisible]);

  useWebDialogAccessibility({
    dialogTitleTestID: 'planPicker.title',
    isVisible,
    onClose,
    testID: 'planPicker.modal',
  });
  const filteredPlans =
    plansState.kind === 'ready'
      ? plansState.predefinedPlans.filter((p) => (planType ? p.planType === planType : true))
      : [];

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setIsPresented(true)}
      onDismiss={() => setIsPresented(false)}
      transparent>
      <View style={[styles.modalOverlay, { backgroundColor: theme.color.overlaySoft }]} testID="planPicker.modal">
        <View
          style={[styles.modalContent, { backgroundColor: theme.color.surface }]}
          testID={isVisible && isPresented ? 'planPicker.ready' : undefined}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.color.textPrimary }]} testID="planPicker.title">
              {t('pro.plan.picker.title')}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} testID="planPicker.close">
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
                <TouchableOpacity
                  key={plan.id}
                  accessible
                  accessibilityLabel={`${plan.name}. ${t('pro.plan.picker.cta_assign')}`}
                  accessibilityRole="button"
                  style={[styles.planRowModal, { borderColor: theme.color.border }]}
                  onPress={() => onSelect(plan.id)}
                  activeOpacity={0.82}
                  testID={`planPicker.assign.${plan.id}`}>
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
                  <View
                    pointerEvents="none"
                    style={[styles.assignPill, { backgroundColor: theme.color.accentPrimary }]}
                    testID={`planPicker.row.${plan.id}`}>
                    <Text style={[styles.assignPillText, { color: theme.color.onAccent }]}>
                      {t('pro.plan.picker.cta_assign') as string}
                    </Text>
                  </View>
                </TouchableOpacity>
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
  assignPill: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
  },
  assignPillText: {
    ...DsTypography.button,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyText: {
    ...DsTypography.body,
    padding: DsSpace.xxl,
    textAlign: 'center',
  },
});
