# TC-001 Navigation And Theme

## Test Cases

| ID | Area | Preconditions | Steps | Expected Result |
|---|---|---|---|---|
| TC-001 | App Launch | App installed | Launch app | Home tab loads by default |
| TC-002 | Role-Aware Navigation (UC-001.2) | Authenticated app on Home with locked Student or Professional role | Select destinations using mobile bottom navigation, tablet rail, or web sidebar | Student destinations are Home, Nutrition, Exercise, Recipes, and Profile; Professional destinations are Home, Nutrition, Exercise, Students, and Profile according to specialty access; the selected destination renders and is announced and highlighted |
| TC-003 | Modal Open | App on Home | Trigger modal link | Modal screen appears |
| TC-004 | Modal Dismiss | Modal open | Tap "Go to home screen" | Modal closes and Home displays |
| TC-005 | Theme | Device set to light then dark | Restart or foreground app in each mode | Theme provider applies matching mode |
| TC-006 | Tokenized Navigation Shell | App launched on light and dark modes | Open any tab and push a stack screen | Tab bar and stack header render DS token colors (canvas/surface/text/border/accent) consistently |

## Notes
- Playwright shell automation exists in `e2e/web/responsive-shell.spec.ts`; it covers role entry, responsive overflow, selected navigation, and shell controls. Do not treat that smoke pack as proof of every destination, modal, theme, or native case in this table.
- Add platform-specific cases for Android, iOS, and web as features expand.
