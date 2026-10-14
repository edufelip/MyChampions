import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { View } from 'react-native';
import { SupportModal } from '@/components/ds/patterns/SupportModal';
import { DsSpace, getDsTheme } from '@/constants/design-system';
import { submitSupportMessage } from '@/features/support/support-source';
import { SupportSourceError } from '@/features/support/support.logic';
import { SUPPORTED_LOCALES, t } from '@/localization/core';
import { hideKeyboard, measureHostViewsAs, showKeyboard } from './keyboard-test-utils';

jest.mock('@/features/auth/auth-session', () => ({
  useAuthSession: () => ({ lockedRole: 'student' }),
}));
let mockNetworkStatus: 'online' | 'offline' = 'online';
jest.mock('@/features/offline/use-network-status', () => ({
  useNetworkStatus: () => mockNetworkStatus,
}));
jest.mock('@/features/support/support-source', () => ({ submitSupportMessage: jest.fn() }));
const transport = jest.mocked(submitSupportMessage);

describe.each(SUPPORTED_LOCALES)('SupportModal rendered behavior: %s (TC-304)', (locale) => {
  const translate = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) =>
    t(locale, key, params);
  const props = {
    isVisible: true,
    scheme: 'light' as const,
    theme: getDsTheme('light'),
    t: translate,
  };
  beforeEach(() => {
    transport.mockReset();
    mockNetworkStatus = 'online';
  });
  async function fill() {
    await fireEvent.changeText(
      screen.getByLabelText(translate('settings.account.support.field.subject.label')),
      '  Need help  ',
    );
    await fireEvent.changeText(
      screen.getByLabelText(translate('settings.account.support.field.body.label')),
      '  My draft needs attention.  ',
    );
  }
  test('invalid fields block transport and show actionable validation', async () => {
    const user = userEvent.setup();
    await render(<SupportModal {...props} onClose={jest.fn()} />);
    await user.press(
      screen.getByRole('button', { name: translate('settings.account.support.cta_submit') }),
    );
    expect(screen.getByTestId('settings.account.support.subjectError')).toBeOnTheScreen();
    expect(transport).not.toHaveBeenCalled();
    await fireEvent.changeText(
      screen.getByLabelText(translate('settings.account.support.field.subject.label')),
      'Valid subject',
    );
    await user.press(
      screen.getByRole('button', { name: translate('settings.account.support.cta_submit') }),
    );
    expect(screen.getByTestId('settings.account.support.bodyError')).toBeOnTheScreen();
    expect(transport).not.toHaveBeenCalled();
  });
  test('pending submission blocks close, Cancel and native request-close callback', async () => {
    let resolve!: (value: string) => void;
    transport.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onClose = jest.fn();
    const user = userEvent.setup();
    await render(<SupportModal {...props} onClose={onClose} />);
    await fill();
    await user.press(
      screen.getByRole('button', { name: translate('settings.account.support.cta_submit') }),
    );
    expect(screen.getByTestId('settings.account.support.closeButton')).toBeDisabled();
    expect(screen.getByTestId('settings.account.support.cancelCta')).toBeDisabled();
    await user.press(screen.getByTestId('settings.account.support.closeButton'));
    await user.press(screen.getByTestId('settings.account.support.cancelCta'));
    await fireEvent(screen.getByTestId('settings.account.support.modal'), 'requestClose');
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText(translate('settings.account.support.field.subject.label')),
    ).toHaveProp('editable', false);
    await act(() => {
      resolve('support-1');
    });
    expect(await screen.findByTestId('settings.account.support.success')).toBeOnTheScreen();
  });
  test('a rejected request retains input and a retry reaches success with trimmed payload', async () => {
    transport
      .mockRejectedValueOnce(new SupportSourceError('network'))
      .mockResolvedValueOnce('support-2');
    const onClose = jest.fn();
    const user = userEvent.setup();
    const rendered = await render(<SupportModal {...props} onClose={onClose} />);
    await fill();
    await user.press(
      screen.getByRole('button', { name: translate('settings.account.support.cta_submit') }),
    );
    expect(await screen.findByTestId('settings.account.support.errorBanner')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(translate('settings.account.support.field.subject.label')),
    ).toHaveDisplayValue('  Need help  ');
    expect(
      screen.getByLabelText(translate('settings.account.support.field.body.label')),
    ).toHaveDisplayValue('  My draft needs attention.  ');
    await user.press(screen.getByRole('button', { name: translate('common.error.retry') }));
    expect(await screen.findByTestId('settings.account.support.success')).toBeOnTheScreen();
    // Retrying the same draft reuses the first attempt's idempotency key (ET-201).
    const [firstAttempt] = transport.mock.calls[0];
    expect(firstAttempt.idempotencyKey).toMatch(/^support-/);
    expect(transport).toHaveBeenLastCalledWith({
      subject: 'Need help',
      body: 'My draft needs attention.',
      userRole: 'student',
      idempotencyKey: firstAttempt.idempotencyKey,
    });
    await user.press(screen.getByRole('button', { name: translate('auth.role.cta_continue') }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await rendered.rerender(<SupportModal {...props} isVisible={false} onClose={onClose} />);
    await rendered.rerender(<SupportModal {...props} onClose={onClose} />);
    expect(
      screen.getByLabelText(translate('settings.account.support.field.subject.label')),
    ).toHaveDisplayValue('');
    expect(
      screen.getByLabelText(translate('settings.account.support.field.body.label')),
    ).toHaveDisplayValue('');
    expect(screen.queryByTestId('settings.account.support.success')).not.toBeOnTheScreen();
  });
  test('offline submission is blocked and connectivity restoration retains the draft', async () => {
    mockNetworkStatus = 'offline';
    transport.mockResolvedValueOnce('support-online');
    const onClose = jest.fn();
    const rendered = await render(<SupportModal {...props} onClose={onClose} />);
    const user = userEvent.setup();
    await fill();
    expect(screen.getByTestId('settings.account.support.offlineBanner')).toHaveTextContent(
      translate('offline.write_lock'),
    );
    expect(screen.getByTestId('settings.account.support.submitCta')).toBeDisabled();
    await user.press(screen.getByTestId('settings.account.support.submitCta'));
    expect(transport).not.toHaveBeenCalled();
    mockNetworkStatus = 'online';
    await rendered.rerender(<SupportModal {...props} onClose={onClose} />);
    expect(
      screen.getByLabelText(translate('settings.account.support.field.subject.label')),
    ).toHaveDisplayValue('  Need help  ');
    await user.press(screen.getByTestId('settings.account.support.submitCta'));
    expect(await screen.findByTestId('settings.account.support.success')).toBeOnTheScreen();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('SupportModal keyboard avoidance (SC-213)', () => {
  test('lifts the sheet above the keyboard on both platforms and keeps its header on screen', async () => {
    // The modal root fills an 844pt screen; the keyboard top sits at 500.
    measureHostViewsAs(View, 0, 844);
    await render(
      <SupportModal
        isVisible
        scheme="light"
        theme={getDsTheme('light')}
        t={(key, params) => t('en-US', key, params)}
        onClose={jest.fn()}
      />,
    );
    const frame = screen.getByTestId('settings.account.support.keyboardFrame');
    await fireEvent(frame, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } },
    });
    expect(frame).toHaveStyle({ paddingBottom: 0 });
    expect(screen.getByTestId('settings.account.support.modal')).toHaveStyle({ maxHeight: '90%' });

    await showKeyboard(500, 344);
    expect(frame).toHaveStyle({ paddingBottom: 344 });
    // No top inset without a safe-area provider; the sheet fits above the keyboard.
    const available = 844 - 344 - DsSpace.sm;
    expect(screen.getByTestId('settings.account.support.modal')).toHaveStyle({
      minHeight: available,
      maxHeight: available,
    });
    expect(screen.getByTestId('settings.account.support.bodyInput')).toBeOnTheScreen();

    await hideKeyboard();
    expect(frame).toHaveStyle({ paddingBottom: 0 });
    expect(screen.getByTestId('settings.account.support.modal')).toHaveStyle({ maxHeight: '90%' });
  });
});
