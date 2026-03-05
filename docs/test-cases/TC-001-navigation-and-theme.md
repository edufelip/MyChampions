# TC-001 Navigation And Theme

## Test Cases

| ID | Area | Preconditions | Steps | Expected Result |
|---|---|---|---|---|
| TC-001 | App Launch | App installed | Launch app | Home tab loads by default |
| TC-002 | Tab Navigation | App on Home | Tap Explore tab | Explore screen loads |
| TC-003 | Modal Open | App on Home | Trigger modal link | Modal screen appears |
| TC-004 | Modal Dismiss | Modal open | Tap "Go to home screen" | Modal closes and Home displays |
| TC-005 | Theme | Device set to light then dark | Restart or foreground app in each mode | Theme provider applies matching mode |
| TC-006 | Tokenized Navigation Shell | App launched on light and dark modes | Open any tab and push a stack screen | Tab bar and stack header render DS token colors (canvas/surface/text/border/accent) consistently |

## Notes
- Convert these into automated tests once navigation test framework is chosen.
- Add platform-specific cases for Android, iOS, and web as features expand.
