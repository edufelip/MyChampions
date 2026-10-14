import assert from 'node:assert/strict';

const phases = {
  'journey-draft-preview': ['NAT-training-local-draft', '3x8'],
  'journey-first-save-reopened': ['NAT-training-first-save', '3x8'],
  'journey-edit-preview': ['NAT-training-edit-draft', '4x10'],
  'journey-edited-save-reopened': ['NAT-training-edited-save', '4x10'],
  'journey-durable-reopened': ['NAT-training-relaunch-read', '4x10'],
} as const;
export function nativeTrainingQuantityContract(label: string, exerciseName: string) {
  assert(Object.hasOwn(phases, label), 'Unknown required native quantity assertion');
  assert(exerciseName.trim() && !/[\r\n]/.test(exerciseName));
  const [assertionId, expected] = phases[label as keyof typeof phases];
  const selectorId = `pro.training_plan.itemRow.${exerciseName.trim().replace(/[^A-Za-z0-9_-]+/g, '_')}.quantity`;
  const idRegex = '^' + selectorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  return { label, assertionId, expected, selectorId, idRegex, textRegex: `^${expected}$` };
}
export function nativeTrainingQuantityYaml(label: string, exerciseName: string) {
  const contract = nativeTrainingQuantityContract(label, exerciseName);
  return `- assertVisible:\n    id: ${JSON.stringify(contract.idRegex)}\n    text: ${JSON.stringify(contract.textRegex)}\n`;
}
