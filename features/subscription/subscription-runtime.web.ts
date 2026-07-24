import type { SubscriptionRuntime } from './subscription-runtime';
import { allowInsecureLocalhostForDevelopment, resolveSafeExternalUrl } from '../platform/external-url';

function resolveHandoffUrl(): string | null {
  try {
    const Constants = require('expo-constants') as {
      default?: { expoConfig?: { extra?: { subscriptionHandoffUrl?: string } } };
      expoConfig?: { extra?: { subscriptionHandoffUrl?: string } };
    };
    const configured =
      (Constants.default ?? Constants).expoConfig?.extra?.subscriptionHandoffUrl ??
      process.env.EXPO_PUBLIC_SUBSCRIPTION_HANDOFF_URL;
    return configured?.trim() || null;
  } catch {
    return process.env.EXPO_PUBLIC_SUBSCRIPTION_HANDOFF_URL?.trim() || null;
  }
}

export function createWebSubscriptionRuntime(
  handoffUrl: string | null,
  deps: {
    openWindow: (url: string) => void;
  }
): SubscriptionRuntime {
  const safeHandoffUrl = resolveSafeExternalUrl(handoffUrl, {
    allowInsecureLocalhost: allowInsecureLocalhostForDevelopment(),
  });
  return {
    purchaseCapability: safeHandoffUrl ? 'mobile_handoff' : 'unavailable',
    openSubscriptionHandoff: async () => {
      if (!safeHandoffUrl) throw new Error('subscription_handoff_not_configured');
      deps.openWindow(safeHandoffUrl);
    },
  };
}

export const subscriptionRuntime = createWebSubscriptionRuntime(resolveHandoffUrl(), {
  openWindow: (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
});
