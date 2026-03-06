import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import type { ProfessionalStudentRosterItem } from '@/features/professional/professional-source';
import type { useTranslation } from '@/localization';

type TFn = ReturnType<typeof useTranslation>['t'];

export function StudentPickerModal({
  isVisible,
  onClose,
  onSelect,
  students,
  isLoading,
  scheme,
  theme,
  t,
}: {
  isVisible: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  students: ProfessionalStudentRosterItem[];
  isLoading: boolean;
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
}) {
  return (
    <Modal visible={isVisible} animationType="slide" transparent>
      <View style={[styles.modalOverlay, { backgroundColor: theme.color.overlaySoft }]}>
        <View style={[styles.modalContent, { backgroundColor: theme.color.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.color.textPrimary }]}>
              {t('pro.plan.assign.title')}
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: theme.color.accentPrimary, fontWeight: '600' }}>
                {t('auth.role.cta_back')}
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalScroll}>
            {isLoading && (
              <ActivityIndicator color={theme.color.accentPrimary} style={{ marginTop: 20 }} />
            )}

            {!isLoading && students.length === 0 && (
              <Text style={[styles.emptyText, { color: theme.color.textSecondary, marginTop: 20 }]}>
                {t('pro.students.empty')}
              </Text>
            )}

            {!isLoading && students.map((student) => (
              <Pressable
                key={student.studentAuthUid}
                style={[styles.templateRow, { borderColor: theme.color.border }]}
                onPress={() => onSelect(student.studentAuthUid)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.templateName, { color: theme.color.textPrimary }]}>
                    {student.displayName}
                  </Text>
                </View>
                <DsPillButton
                  scheme={scheme}
                  label={t('pro.plan.picker.cta_assign')}
                  onPress={() => onSelect(student.studentAuthUid)}
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
  templateRow: {
    borderWidth: 1,
    borderRadius: DsRadius.lg,
    padding: DsSpace.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DsSpace.sm,
  },
  templateName: { fontWeight: '700', fontSize: 15 },
  emptyText: {
    ...DsTypography.body,
    padding: DsSpace.xxl,
    textAlign: 'center',
  },
});
