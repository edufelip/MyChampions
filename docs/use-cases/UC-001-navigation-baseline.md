# UC-001 Navigation Baseline

## UC-001.1 Open Home Screen
- Primary actor: App user.
- Trigger: User launches app.
- Preconditions: App installed and starts successfully.
- Main flow:
  1. User opens the app.
  2. App resolves root stack to tab navigator.
  3. Home tab is shown.
- Expected result: Home content is visible and responsive.

## UC-001.2 Open Explore Screen
- Primary actor: App user.
- Trigger: User taps Explore tab.
- Preconditions: App is open on tab navigator.
- Main flow:
  1. User taps Explore tab icon.
  2. App navigates to `/explore`.
- Expected result: Explore screen renders with informational sections.

## UC-001.3 Open Modal And Return
- Primary actor: App user.
- Trigger: User activates Home link to modal.
- Preconditions: User is on Home screen.
- Main flow:
  1. User taps the modal entry point in Home.
  2. App opens `/modal` with modal presentation.
  3. User taps return link.
  4. App dismisses modal to Home.
- Expected result: User returns to Home without app restart.
