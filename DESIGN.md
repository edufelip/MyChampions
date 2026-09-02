---
name: MyChampions
description: Athletic, focused care-plan and adherence product for students and professionals.
colors:
  primary: '#1f7a4c'
  primary-hover: '#175f3b'
  primary-dark: '#4ade80'
  on-primary-light: '#fbf9f5'
  on-primary-dark: '#0e1a12'
  accent-warm: '#a06813'
  accent-warm-dark: '#e0a838'
  canvas-light: '#faf9f7'
  surface-light: '#ffffff'
  text-light: '#262420'
  text-muted-light: '#5b5548'
  border-light: '#ece7dd'
  border-dark: '#3a352b'
  canvas-dark: '#181510'
  surface-dark: '#211d17'
  text-dark: '#f5f1e9'
  danger: '#b3261e'
  warning: '#b45309'
  cyan: '#06b6d4'
typography:
  title:
    fontFamily: 'Manrope_800ExtraBold'
    fontSize: '28px'
    fontWeight: 800
    lineHeight: 1.21
    letterSpacing: '-0.3px'
  body:
    fontFamily: 'Manrope_500Medium'
    fontSize: '14px'
    fontWeight: 500
    lineHeight: 1.43
    letterSpacing: 'normal'
  label:
    fontFamily: 'Manrope_700Bold'
    fontSize: '15px'
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: 'normal'
rounded:
  sm: '10px'
  md: '14px'
  lg: '22px'
  xl: '28px'
  pill: '999px'
spacing:
  xxs: '4px'
  xs: '8px'
  sm: '12px'
  md: '16px'
  lg: '20px'
  xl: '24px'
  xxl: '32px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary-light}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '12px 20px'
  card:
    backgroundColor: '{colors.surface-light}'
    textColor: '{colors.text-light}'
    rounded: '{rounded.lg}'
    padding: '16px'
---

## Overview

MyChampions uses a restrained product register: a low-noise warm-neutral canvas, clear surfaces, and green reserved for commitment actions and active state, with a gold accent reserved for streaks and encouragement moments. Responsive web preserves the mobile information architecture while increasing navigation persistence and content density for keyboard and pointer use. This is the "Warm & Human" direction (`D-217`), picked from a design-exploration canvas and rolled out app-wide.

## Colors

Green is the primary action and progress color, warm near-black ink carries hierarchy, and cyan is a supporting data accent (used for hydration/water only). Light mode uses the deeper `#1f7a4c` action green with light labels; dark mode uses `#4ade80` with near-black labels so controls and links remain readable. A dedicated warm gold accent (`#a06813` light / `#e0a838` dark) is reserved for streaks and positive-reinforcement moments — never for primary actions. Disabled controls use explicit surface, label, and border tokens rather than opacity. Light mode uses `#faf9f7` with white surfaces; dark mode uses `#181510` with warm dark surfaces. Error, warning, success, offline, and read-only states always use the semantic tokens in `constants/design-system.ts` rather than new literals.

## Typography

Manrope is loaded app-wide via `@expo-google-fonts/manrope`, gated in `app/_layout.tsx`. Each `DsTypography` role maps to one specific static weight (`DsFontFamily` in `constants/design-system.ts`) rather than relying on the `fontWeight` style prop, since custom fonts don't reliably interpolate weight across platforms — titles use ExtraBold, secondary headings/buttons use Bold, and body/caption use Medium. Titles are compact and decisive; body text prioritizes readability. Do not introduce a second display face or tightly tracked labels. Long prose stays within roughly 65–75 characters per line.

## Elevation

Surface depth is restrained but no longer flat: standard cards use one soft, diffused shadow (`DsShadow.soft`) with no border — never a border and a shadow on the same surface. Floating layers (true overlays, and the professional roster's floating bulk-action tray) use the `DsShadow.floating` preset. Do not introduce glass effects.

## Components

Use `DsScreen`, `DsCard`, `DsPillButton`, `DsIconButton`, `DsBackButton`, `DsOfflineBanner`, and the established pattern components before adding local variants. Interactive components need default, hover/focus on web, active, disabled, loading, and error behavior. Browser navigation changes position and density, not route ownership or labels. `DsScreen`'s decorative blob background is opt-in (`withBlobs`), off by default app-wide — see `D-217`.

## Do's and Don'ts

- Do preserve the mobile workflow and adapt layout, navigation, focus, and pointer feedback for browsers.
- Do keep content centered at readable maximum widths on large displays.
- Do expose offline, read-only, subscription, and provider failures explicitly.
- Don’t stretch phone layouts edge-to-edge on desktop or rely on hover for functionality.
- Don’t add neon gradients, decorative fitness imagery, decorative background blobs, nested cards, or new hard-coded colors.
- Don’t hide core behavior on web when a browser-appropriate fallback is available.
