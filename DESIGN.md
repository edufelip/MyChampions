---
name: MyChampions
description: Athletic, focused care-plan and adherence product for students and professionals.
colors:
  primary: "#167a42"
  primary-hover: "#126237"
  primary-dark: "#4ade80"
  on-primary-light: "#f8fafc"
  on-primary-dark: "#07150c"
  canvas-light: "#f6f8f6"
  surface-light: "#ffffff"
  text-light: "#0f172a"
  text-muted-light: "#475569"
  border-light: "#e2e8f0"
  border-dark: "#374151"
  canvas-dark: "#102215"
  surface-dark: "#111827"
  text-dark: "#f8fafc"
  danger: "#b3261e"
  warning: "#b45309"
  cyan: "#06b6d4"
typography:
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.21
    letterSpacing: "-0.3px"
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "normal"
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "normal"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary-light}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "12px 20px"
  card:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

## Overview

MyChampions uses a restrained product register: a low-noise canvas, clear surfaces, and green reserved for commitment actions and active state. Responsive web preserves the mobile information architecture while increasing navigation persistence and content density for keyboard and pointer use.

## Colors

Green is the primary action and progress color, navy-toned ink carries hierarchy, and cyan is a supporting data accent. Light mode uses the deeper `#167a42` action green with light labels; dark mode uses `#4ade80` with near-black labels so controls and links remain readable. Disabled controls use explicit surface, label, and border tokens rather than opacity. Light mode uses `#f6f8f6` with white surfaces; dark mode uses `#102215` with slate surfaces. Error, warning, success, offline, and read-only states always use the semantic tokens in `constants/design-system.ts` rather than new literals.

## Typography

Use the existing system/rounded font bridge and fixed product type scale. Titles are compact and decisive; body text prioritizes readability. Do not introduce display fonts, fluid hero typography, or tightly tracked labels. Long prose stays within roughly 65–75 characters per line.

## Elevation

Surface depth is restrained. Standard cards use tonal separation or the existing soft shadow; floating layers use the existing floating preset only for true overlays. Do not pair wide decorative shadows with borders, and do not introduce glass effects.

## Components

Use `DsScreen`, `DsCard`, `DsPillButton`, `DsIconButton`, `DsBackButton`, `DsOfflineBanner`, and the established pattern components before adding local variants. Interactive components need default, hover/focus on web, active, disabled, loading, and error behavior. Browser navigation changes position and density, not route ownership or labels.

## Do's and Don'ts

- Do preserve the mobile workflow and adapt layout, navigation, focus, and pointer feedback for browsers.
- Do keep content centered at readable maximum widths on large displays.
- Do expose offline, read-only, subscription, and provider failures explicitly.
- Don’t stretch phone layouts edge-to-edge on desktop or rely on hover for functionality.
- Don’t add neon gradients, decorative fitness imagery, nested cards, or new hard-coded colors.
- Don’t hide core behavior on web when a browser-appropriate fallback is available.
