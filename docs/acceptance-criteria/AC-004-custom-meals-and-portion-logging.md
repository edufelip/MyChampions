# AC-004 Custom Meals And Portion Logging (Proposed)

## Feature
Users create reusable custom meals and log consumed portions in grams with proportional nutrient calculations.

## Acceptance Criteria
- `AC-401`: User can create a custom meal with required fields: name, total grams, calories, carbs, proteins, fats.
- `AC-402`: User can optionally save ingredient cost for a custom meal.
- `AC-403`: User can select a saved custom meal and log consumed grams.
- `AC-404`: System calculates consumed calories/macros proportionally from consumed grams and meal totals.
- `AC-405`: Saved custom meals are reusable for future logging.
- `AC-406`: Editing a custom meal updates future usage only; previously logged entries keep historical nutrition values.
- `AC-407`: Custom meal feature is accessible without professional connection.
- `AC-408`: User can generate a share link for a custom meal/recipe they own.
- `AC-409`: Opening a valid shared recipe link shows confirmation screen before save.
- `AC-410`: Confirming save from shared link creates recipient-owned recipe copy.
- `AC-411`: Recipient-owned copies remain available if creator deletes source recipe.
- `AC-412`: Source edits/deletion do not mutate recipient-owned copies already saved.
- `AC-413`: Custom meal create/edit/share and shared-save flows are available to any authenticated account role.
- `AC-414`: Shared recipe links do not expire automatically.
- `AC-415`: Recipe creators cannot revoke previously generated shared links.
- `AC-416`: Repeated save attempts by the same recipient on the same shared link are idempotent and do not create duplicate copies.
- `AC-417`: Logged-out users opening a shared link must authenticate and resume the same shared-link flow after login.
- `AC-418`: Shared-link import payload includes nutrition-tracking fields and excludes ingredient-cost metadata.
- `AC-419`: Shared-link import remains available even if source recipe is deleted before recipient save.
- `AC-420`: Custom meal/recipe records use UUID primary identifiers for source and imported copies.
- `AC-421`: Share-link generation/open/import endpoints enforce rate limiting and return retryable responses when limit is exceeded.
- `AC-422`: Analytics/observability events do not include full shared-link values or raw share tokens.
- `AC-423`: Recipe identifiers conform to UUIDv7 format.
- `AC-424`: Recipe image upload flows show visible upload progress and recoverable-failure reason with retry action.
- `AC-425`: When a recoverable image upload failure occurs, recipe draft fields remain preserved for retry.

## Gherkin Scenarios
```gherkin
Feature: Custom meal creation and portion logging

  Scenario: Create custom meal
    Given an authenticated user
    When the user saves a custom meal with required fields
    Then the custom meal appears in the user's meal library

  Scenario: Log 100g from custom meal
    Given a custom meal exists with total grams and nutrient totals
    When the user logs 100 grams of that meal
    Then the system stores proportionally calculated calories and macros
    And daily totals are updated

  Scenario: Edit custom meal after previous logs
    Given a custom meal has prior logged entries
    When the user edits the meal definition
    Then future logs use updated values
    And prior logs remain unchanged

  Scenario: Save shared recipe copy
    Given a creator shares a recipe link
    And a recipient opens the link while authenticated
    When the recipient confirms save
    Then a recipient-owned recipe copy is created

  Scenario: Creator deletes source recipe after sharing
    Given a recipient already saved a shared recipe copy
    When the creator deletes the source recipe
    Then the recipient copy remains available in recipient account

  Scenario: Role-agnostic recipe sharing access
    Given an authenticated user in any supported role
    When the user opens custom meal create/edit/share and shared-save flows
    Then access is granted according to authentication and ownership rules

  Scenario: Shared link login and resume flow
    Given a recipient is logged out
    When the recipient opens a valid shared recipe link
    Then the app requests authentication
    And after login the recipient returns to the same shared recipe confirmation flow

  Scenario: Idempotent shared import for same recipient
    Given a recipient already saved recipe from a shared link
    When the same recipient confirms save again from that same link
    Then the app does not create a duplicate recipe copy
    And the existing saved copy is returned

  Scenario: Shared link remains importable after source deletion-before-save
    Given a creator generated a shared recipe link
    And the creator deletes the source recipe before recipient saves
    When recipient opens the shared link and confirms save
    Then import succeeds using the immutable shared snapshot

  Scenario: Shared-link endpoint rate limiting
    Given a client exceeds allowed share-link endpoint request rate
    When the client calls share generation, link open, or import endpoints
    Then the request is rate-limited with retry guidance

  Scenario: Shared-link values are redacted from telemetry
    Given shared-link operations are executed
    When analytics and observability events are recorded
    Then full shared-link values and raw share tokens are not present in logged payloads

  Scenario: Recipe image upload progress and retry
    Given a user is creating or editing a custom meal with image upload
    When upload starts
    Then progress is shown to the user
    When a recoverable upload failure occurs
    Then user sees failure reason and retry action
    And recipe draft fields remain preserved
```
