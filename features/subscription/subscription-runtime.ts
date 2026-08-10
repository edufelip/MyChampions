export type SubscriptionPurchaseCapability = 'native_purchase' | 'mobile_handoff' | 'unavailable';

export type SubscriptionRuntime = {
  purchaseCapability: SubscriptionPurchaseCapability;
  openSubscriptionHandoff: () => Promise<void>;
};

export const subscriptionRuntime: SubscriptionRuntime = {
  purchaseCapability: 'native_purchase',
  openSubscriptionHandoff: async () => {},
};
