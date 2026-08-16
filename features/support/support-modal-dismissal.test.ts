import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { requestSupportModalDismissal } from './support.logic';

const root = join(__dirname, '..', '..');
const modalSource = readFileSync(
  join(root, 'components', 'ds', 'patterns', 'SupportModal.tsx'),
  'utf8',
);
const dialogHookSource = readFileSync(
  join(root, 'hooks', 'use-web-dialog-accessibility.ts'),
  'utf8',
);

test('support modal close controls use the submission-aware dismissal guard', () => {
  assert.match(
    modalSource,
    /<Pressable[\s\S]*?onPress=\{handleClose\}[\s\S]*?disabled=\{isSubmitting\}[\s\S]*?testID="settings\.account\.support\.closeButton"/,
  );
  assert.match(
    modalSource,
    /<DsPillButton[\s\S]*?onPress=\{handleClose\}[\s\S]*?disabled=\{isSubmitting\}[\s\S]*?testID="settings\.account\.support\.cancelCta"/,
  );
});

test('support modal web Escape callback uses the submission-aware dismissal guard', () => {
  assert.match(
    modalSource,
    /useWebDialogAccessibility\(\{[\s\S]*?isVisible,[\s\S]*?onClose: handleClose,[\s\S]*?testID: 'settings\.account\.support\.modal'/,
  );
  assert.match(modalSource, /dialogTitleTestID: 'settings\.account\.support\.dialog\.title'/);
  assert.match(modalSource, /testID="settings\.account\.support\.dialog\.title"/);
  assert.match(
    modalSource,
    /accessibilityLabel=\{t\('settings\.account\.support\.dialog\.close'\) as string\}/,
  );
});

test('web dialog accessibility hook names the existing React Native Modal ancestor instead of stamping a second nested dialog role', () => {
  // React Native's own <Modal> already renders a web ancestor with role="dialog" and
  // aria-modal="true" once active (react-native-web ModalContent). The hook must reuse
  // that ancestor for aria-labelledby rather than adding role/aria-modal directly on the
  // inner testID node, or two overlapping dialog roles would be exposed to assistive tech.
  assert.match(
    dialogHookSource,
    /const dialogEl = root\?\.closest<HTMLElement>\('\[aria-modal="true"\]'\) \?\? root;/,
  );
  assert.match(dialogHookSource, /const ownsDialogRole = dialogEl === root;/);
  assert.match(
    dialogHookSource,
    /if \(ownsDialogRole\) \{\s*dialogEl\.setAttribute\('role', 'dialog'\);\s*dialogEl\.setAttribute\('aria-modal', 'true'\);\s*\}/,
  );
  assert.match(dialogHookSource, /dialogEl\.setAttribute\('aria-labelledby', generatedTitleId\)/);
  assert.match(dialogHookSource, /const canApplyDialogSemantics = Boolean\(dialogEl && title\)/);
});

test('web dialog accessibility hook restores prior dialog-ancestor attributes on cleanup, gated by ownership', () => {
  assert.match(
    dialogHookSource,
    /if \(dialogEl && canApplyDialogSemantics && previousAttributes\) \{\s*if \(ownsDialogRole\) \{/,
  );
  assert.match(dialogHookSource, /previousAttributes\.role/);
  assert.match(dialogHookSource, /previousAttributes\.ariaModal/);
  assert.match(dialogHookSource, /previousAttributes\.ariaLabel\b/);
  assert.match(dialogHookSource, /previousAttributes\.ariaLabelledBy/);
});

test('support modal native back callback uses the submission-aware dismissal guard', () => {
  assert.match(
    modalSource,
    /<Modal visible=\{isVisible\} animationType="slide" onRequestClose=\{handleClose\} transparent>/,
  );
});

test('support modal blocks dismissal while submitting and resumes it afterward', () => {
  let closeCount = 0;
  const onClose = () => {
    closeCount += 1;
  };

  assert.equal(requestSupportModalDismissal({ isSubmitting: true, onClose }), false);
  assert.equal(closeCount, 0);

  assert.equal(requestSupportModalDismissal({ isSubmitting: false, onClose }), true);
  assert.equal(closeCount, 1);
});
