# FR-000 App Foundation

## Goal
Define the baseline functional requirements for the initial app shell.

## Requirements
- `FR-001`: The app shall provide a tab-based navigation root with at least two tabs.
- `FR-002`: The app shall expose a Home screen at route `/`.
- `FR-003`: The app shall expose an Explore screen at route `/explore`.
- `FR-004`: The app shall expose a modal screen at route `/modal`.
- `FR-005`: The app shall allow navigation from Home to Modal and back to Home.
- `FR-006`: The app shall adapt theme provider values to device light/dark mode.
- `FR-007`: The app shall run on Android, iOS, and web through Expo workflows.

## Out Of Scope For This Baseline
- Authentication.
- Backend APIs.
- Persistent user data.
- Domain-specific champion features.

## Next Requirements To Define
- Domain entities and data model.
- End-to-end user journey per planned feature.
- Offline behavior and sync policy.
- Notification and background processing requirements.
