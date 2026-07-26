# ADR 0007: Web Subscription Entitlement and Handoff

## Status

Accepted — 2026-07-15

## Context

RevenueCat's React Native browser preview behavior is not an authoritative purchase or entitlement runtime. Browser billing is outside the current phase, but professional and AI access rules must remain enforced.

## Decision

`SubscriptionRuntime` exposes `native_purchase`, `mobile_handoff`, or `unavailable`. Native uses RevenueCat purchase/restore/paywalls. Web imports no RevenueCat runtime, reads the server's entitlement snapshot, and opens the localized `EXPO_PUBLIC_SUBSCRIPTION_HANDOFF_URL` when configured. Missing configuration is unavailable and never inferred from `Platform.OS` in screens.

Unknown entitlement fails closed for paid AI access and cap-sensitive professional actions. The free professional tier remains available below its cap.

## Consequences

- Browser users can use entitled features but cannot purchase or restore in-browser.
- Entitlement freshness depends on the authoritative server snapshot.
- Web billing, provider configuration, and handoff destination activation require a later approved task.
