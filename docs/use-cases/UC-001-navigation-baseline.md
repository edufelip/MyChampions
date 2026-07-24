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

## UC-001.2 Open Role-Aware Tab Screen
- Primary actor: App user.
- Trigger: User selects a destination in the role-aware navigation shell.
- Preconditions: App is open on the authenticated tab navigator and the account role is locked.
- Main flow:
  1. Student navigation exposes Home, Nutrition, Exercise, Recipes, and Profile.
  2. Professional navigation exposes Home, Nutrition, Exercise, Students, and Profile according to specialty access.
  3. User selects a destination using bottom navigation on mobile, the compact rail on tablet, or the labeled sidebar on web.
- Expected result: The role-appropriate destination renders and the selected navigation item is announced and highlighted.

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
