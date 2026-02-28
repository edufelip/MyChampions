# AC-001 Navigation And Routing

## Feature
Initial shell navigation with Home, Explore, and Modal flows.

## Acceptance Criteria
- `AC-001`: On app launch, Home tab is the default visible screen.
- `AC-002`: Tapping Explore tab opens route `/explore`.
- `AC-003`: From Home, user can open route `/modal`.
- `AC-004`: On Modal, user can dismiss back to Home.
- `AC-005`: Bottom tab bar remains visible on tab screens and hidden during modal presentation.
- `AC-006`: App theme provider switches between light/dark tokens based on device color scheme.

## Gherkin Scenarios
```gherkin
Feature: Core navigation

  Scenario: Open app and view Home
    Given the app is launched
    When routing is initialized
    Then the Home tab is selected

  Scenario: Navigate to Explore
    Given the app is on Home
    When the user taps Explore tab
    Then the Explore screen is displayed

  Scenario: Open and dismiss modal
    Given the user is on Home
    When the user opens the modal route
    Then the modal screen is displayed
    When the user taps go to home
    Then the user is returned to Home
```
