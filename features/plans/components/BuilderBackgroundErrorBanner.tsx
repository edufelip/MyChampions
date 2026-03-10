import type { DsTheme } from '@/constants/design-system';

import { BuilderAlertBanner } from '@/features/plans/components/BuilderAlertBanner';

type BuilderBackgroundErrorBannerProps = {
  theme: DsTheme;
  message: string;
};

export function BuilderBackgroundErrorBanner({
  theme,
  message,
}: BuilderBackgroundErrorBannerProps) {
  return (
    <BuilderAlertBanner
      message={message}
      backgroundColor={theme.color.warningSoft}
      borderColor={theme.color.warning}
      textColor={theme.color.warning}
    />
  );
}
