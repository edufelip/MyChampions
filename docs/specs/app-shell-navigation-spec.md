# App Shell Navigation Spec

## Purpose
Define current behavior of the app shell navigation implemented with Expo Router.

## Scope
- Root stack and tab layout behavior.
- Home, Explore, and Modal screen navigation behavior.
- Theme provider behavior tied to device color scheme.

## Definitions and Terminology
- App shell: top-level navigation structure available immediately after launch.
- Tab route: first-level route rendered inside tab navigator.
- Modal route: stack route presented above tab routes.

## Inputs and Outputs
- Inputs:
  - App launch event.
  - Tab press interactions.
  - Modal open/dismiss interactions.
  - Device color scheme value (light/dark).
- Outputs:
  - Active route selection.
  - Visible screen content.
  - Theme provider value.

## Expected Behavior
1. On launch, root stack is initialized.
2. Tab layout route is loaded with Home and Explore tabs.
3. Home tab is accessible at `/`; Explore tab is accessible at `/explore`.
4. Modal route is accessible at `/modal` and presented as modal.
5. Dismissing modal returns user to Home route.
6. Theme provider maps device color scheme to dark or default navigation theme.

## Error Handling and Edge Cases
- If color scheme is unavailable, default theme path remains available.
- If modal is opened from Home, dismiss action must return to Home instead of undefined navigation state.

## Invariants and Guarantees
- Root shell always provides at least the two baseline tabs.
- Modal route is isolated from tab bar interaction while presented.
- Routing path names remain stable unless docs and tests are updated together.

## Non-Goals
- Domain-specific feature behavior beyond starter shell.
- API calls and persistence behavior.

## Open Questions or Ambiguities
- Should modal be globally accessible from routes other than Home?
- Will dark/light behavior remain system-driven or become user-configurable?
