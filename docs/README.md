# Application Documentation Workspace

This repository uses a documentation-first workflow.

## Purpose
- Plan and describe the app before implementation.
- Keep requirements, behavior, UI flows, and tests aligned.
- Ensure every code change is validated against current docs.

## Structure
- `docs/functional-requirements/`: functional requirements and scope.
- `docs/specs/`: behavior-oriented technical and product specs.
- `docs/use-cases/`: actor-centered usage flows.
- `docs/acceptance-criteria/`: testable acceptance rules for features.
- `docs/business-rules/`: domain and system rules that must always hold.
- `docs/test-cases/`: manual/automated test scenarios.
- `docs/screens/`: screen-by-screen planning and design notes.
- `docs/diagrams/`: Mermaid diagrams and architecture illustrations.
- `docs/discovery/`: open questions, decisions, and unresolved assumptions.
  - Includes `pending-wiring-checklist-v1.md` for intentionally deferred implementation wiring tasks.
- `docs/compliance/`: release policy baselines and store/privacy controls.
- `docs/templates/`: reusable templates for new documentation entries.

## Documentation Flow
1. Define or update functional requirements.
2. Describe use cases and business rules.
3. Add acceptance criteria.
4. Plan screen behavior and navigation.
5. Write or update test cases.
6. Update diagrams when flow or architecture changes.

## Current Baseline
- App foundation: Expo Router tabs template.
- Current screens: Home (`/`), Explore (`/explore`), Modal (`/modal`).
- This baseline is captured in section docs and should evolve with implementation.
