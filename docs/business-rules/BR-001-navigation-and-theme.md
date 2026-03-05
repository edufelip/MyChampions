# BR-001 Navigation And Theme Rules

## Rules
- `BR-001`: Tab navigator is the primary app shell for top-level sections.
- `BR-002`: Modal routes are transient contexts and must provide a deterministic return path.
- `BR-003`: Theme choice is derived from device color scheme unless an explicit product rule overrides it.
- `BR-004`: Route naming must stay stable and human-readable for maintainability.
- `BR-005`: Every new screen must define route ownership and placement (tab, stack, modal, nested flow).
- `BR-006`: New UI surfaces must consume semantic design-system tokens; introducing raw hex values in shared primitives is not allowed unless documented as an exception.

## Constraints
- Navigation changes must update use cases, acceptance criteria, and diagrams in the same change.
- Business rule changes must include explicit impact notes on test cases.
