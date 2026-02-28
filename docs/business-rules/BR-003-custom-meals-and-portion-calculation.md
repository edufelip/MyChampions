# BR-003 Custom Meals And Portion Calculation (Proposed)

## Rules
- `BR-301`: A custom meal must have a non-empty name and total meal weight in grams greater than zero.
- `BR-302`: Custom meal nutrition values (calories, carbs, proteins, fats) must be non-negative.
- `BR-303`: Ingredient cost is optional; when provided, it must be non-negative.
- `BR-304`: Portion logging grams must be greater than zero.
- `BR-305`: Portion logging calculations must use proportional scaling from saved meal totals.
- `BR-306`: Users may log portion grams greater than the original meal weight (multiple portions/scaled consumption).
- `BR-307`: Saved custom meals are reusable across future nutrition logs for the same account.
- `BR-308`: Editing a custom meal does not retroactively alter already-saved nutrition logs; logs keep the nutrition snapshot used at entry time.
- `BR-309`: Custom meal functionality is available without professional assignment.
- `BR-310`: Any account owner of a custom meal can generate a share link for that meal.
- `BR-311`: Opening a valid share link must show an explicit confirmation step before saving into recipient account.
- `BR-312`: Saving from a share link creates a recipient-owned copy (copy-on-save), not a mutable reference.
- `BR-313`: Recipient-owned copies remain available even if source meal is later edited or deleted by creator.
- `BR-314`: Recipient copy lineage to source may be stored for auditability, but ownership and availability are independent.
- `BR-315`: Sharing flow is available to all authenticated account roles.
- `BR-316`: Custom meal create/edit/share flows are available to all authenticated account roles.
- `BR-317`: Shared recipe links do not expire automatically.
- `BR-318`: Meal owners cannot revoke previously generated shared links.
- `BR-319`: A shared link may be used by multiple different recipients, each receiving an independent account-owned copy on save.
- `BR-320`: Import from the same shared link by the same recipient is idempotent and must return/reuse the already-saved recipient copy.
- `BR-321`: Opening a shared link while unauthenticated requires login and must resume the same shared-link token flow after authentication.
- `BR-322`: Shared-link import payload contains nutrition-tracking fields only (`name`, `total_grams`, `calories`, `carbs`, `proteins`, `fats`) and excludes ingredient cost metadata.
- `BR-323`: Share links reference immutable share snapshots at generation time; source-recipe edits or deletion do not change import payload for existing links.
- `BR-324`: Custom meal/recipe primary identifiers use UUID format for original and recipient-owned copy records.
- `BR-325`: Sharing endpoints (generate/open/import) are rate-limited per abuse-control policy.
- `BR-326`: Full shared-link values/raw share tokens must not be persisted in analytics or general observability logs.
- `BR-327`: Recipe identifiers use UUIDv7 (time-ordered UUID) as canonical format.

## Calculation Reference
For each nutrient in `{calories, carbs, proteins, fats}`:
- `consumed_nutrient = (consumed_grams / meal_total_grams) * meal_total_nutrient`

## Constraints
- Any formula or field-rule change requires updates to FR, UC, AC, TC, specs, and affected screen docs.
- Any ownership or sharing-rule change requires updates to FR, UC, AC, TC, specs, diagrams, and localization keys.
