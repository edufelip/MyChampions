# TC-332 Extension: Open Exercise Search Resize

## Traceability

- Parent: TC-332 in [role and assignment controls](TC-002-role-and-assignment-controls.md).
- Screen: [SC-208 Training Plan Builder](../screens/v2/SC-208-training-plan-builder.md).
- Responsive decision: ET-172 shared desktop dialog; compact sheet treatment remains unchanged.
- This documents existing behavior, not a new product requirement or provider validation.

## TC-332-R1: Preserve Search Across Responsive Boundaries

Preconditions: local training Playwright fixture profile, fresh Chromium context with touch-enabled Pixel 5 emulation, Professional role, assigned training plan with its session available. Browser viewport resizing models available space; it does not prove native keyboard behavior.

1. Open the assigned training plan and choose Add exercise.
2. Enter `push` and submit. Wait for the deterministic Push-Up result.
3. Without closing the dialog, resize through 1440x1000, 767x720, 768x720, 320x520, then 1440x1000.
4. At each size, verify the query remains `push`, the result remains visible, and all dialog bounds remain within the viewport.
5. At widths at or above 768px, verify equal horizontal and vertical margins (within 2px).
6. Activate the localized Close control and verify the dialog disappears.

Expected: no search-state reset; viewport-bounded compact sheet below 768px; centered dialog at or above 768px; dismissal remains usable. Capture a screenshot at each boundary, accessibility state, console/network diagnostics, and a browser trace.

## Evidence And Automation Boundary

Observed passing on 2026-09-12 at app commit `9d0c3f4862e6c8b8004fd3378f9d6897ae46493e` in local exploration `20260912-web-recovery-exploration` (Linear ET-190). The exploratory runner and screenshots are under `.qa/artifacts/20260912-web-recovery-exploration/`; this runner is not a committed CI regression test. Existing permanent initial/compact/desktop cases remain in `e2e/web/exercise-search-modal.spec.ts`.

No native device, live exercise service, persistence, or production claim is made.
