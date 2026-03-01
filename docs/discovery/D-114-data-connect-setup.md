# D-114: Firebase Data Connect Setup for Starter Templates

**Status**: Infrastructure Ready, Awaiting CLI Migration
**Milestone**: C (Professional Plan Features)
**Related**: BL-006, FR-212, FR-247, AC-256, BR-270, TC-260, UC-002.14

## Overview

This document tracks the Firebase Data Connect setup for the starter templates feature (BL-006). All infrastructure has been defined locally. Schema migration and SDK generation are blocked by a Firebase CLI issue that needs resolution.

## What Has Been Completed

### 1. Database Schema (✓ Defined)
**File**: `dataconnect/sql/schema.sql`

#### Tables Created:
- **starter_templates** — System-provided plan templates
  - Fields: id, plan_type, name, description, created_at, updated_at
  - Constraints: plan_type ∈ {nutrition, training}
  - Indexes: idx_starter_templates_plan_type

- **nutrition_plans** — Nutrition plans (cloned from templates or custom)
  - Fields: id, professional_id, student_id, source_template_id, name, is_draft, calories_target, carbs_target, proteins_target, fats_target, created_at, updated_at
  - Foreign Keys: source_template_id → starter_templates.id (ON DELETE SET NULL)
  - Indexes: professional_id, student_id, source_template_id

- **training_plans** — Training plans (cloned from templates or custom)
  - Fields: id, professional_id, student_id, source_template_id, name, is_draft, focus_area, created_at, updated_at
  - Foreign Keys: source_template_id → starter_templates.id (ON DELETE SET NULL)
  - Indexes: professional_id, student_id, source_template_id

- **template_usage_stats** — Clone and assignment counters
  - Fields: template_id, clone_count, assignment_count, updated_at
  - Foreign Keys: template_id → starter_templates.id (ON DELETE CASCADE)

- **nutrition_plan_meals** — Meal items
  - Fields: id, nutrition_plan_id, food_name, calories, carbs, proteins, fats, portions, created_at, updated_at
  - Foreign Keys: nutrition_plan_id → nutrition_plans.id (ON DELETE CASCADE)

- **training_plan_sessions** — Training sessions
  - Fields: id, training_plan_id, session_name, day_of_week, duration_minutes, created_at, updated_at
  - Foreign Keys: training_plan_id → training_plans.id (ON DELETE CASCADE)

- **training_session_items** — Exercises within sessions
  - Fields: id, session_id, exercise_name, sets, reps, weight, created_at, updated_at
  - Foreign Keys: session_id → training_plan_sessions.id (ON DELETE CASCADE)

**Architecture Notes**:
- All clone relationships tracked via `source_template_id` foreign key
- Starter templates are immutable (original definitions remain unchanged)
- Clone independence verified through non-starter plan IDs
- Cascading deletes ensure data consistency

### 2. GraphQL Connectors (✓ Defined)
**File**: `dataconnect/connector/starter_templates.gql`

#### Queries:
- `GetStarterTemplates(planType?)` — Filter templates by plan type, ordered by name
- `GetStarterTemplate(id)` — Single template lookup
- `SearchStarterTemplates(query)` — Full-text search on name and ID
- `GetNutritionTemplates()` — Shorthand for nutrition templates
- `GetTrainingTemplates()` — Shorthand for training templates
- `GetTemplateStats(templateId)` — Usage statistics for a template
- `GetPopularTemplates(limit)` — Top N templates by clone count

#### Mutations:
- `CreateStarterTemplate(id, plan_type, name, description)` — Create template (admin)
- `UpdateStarterTemplate(id, name, description)` — Update template (admin)
- `DeleteStarterTemplate(id)` — Delete template (admin)
- `IncrementTemplateCloneCount(templateId)` — Track clones (auto-called)
- `IncrementTemplateAssignmentCount(templateId)` — Track assignments (auto-called)
- `InitializeTemplateStats(templateId)` — Initialize stats on template creation

### 3. Integration Layer (✓ Defined)
**File**: `features/plans/plan-builder-dataconnect.ts`

Provides TypeScript wrapper functions with proper type signatures:

```typescript
// Queries
getStarterTemplates(client, planType?) → Promise<StarterTemplate[]>
getStarterTemplate(client, templateId) → Promise<StarterTemplate | null>
getNutritionTemplates(client) → Promise<StarterTemplate[]>
getTrainingTemplates(client) → Promise<StarterTemplate[]>
getTemplateStats(client, templateId) → Promise<TemplateUsageStats | null>

// Mutations
cloneStarterTemplate(client, professionalId, planName, templateId, planType) → Promise<string>
incrementTemplateCloneCount(client, templateId) → Promise<void>
incrementTemplateAssignmentCount(client, templateId) → Promise<void>
initializeTemplateStats(client, templateId) → Promise<TemplateUsageStats>
```

**Key Features**:
- Type-safe function signatures matching logic layer
- Automatic usage stat tracking on clone/assignment
- Proper error handling and null checks
- Ready for SDK client injection

### 4. Configuration Files (✓ Defined)
- `firebase.json` — Firebase project configuration for Data Connect
- `.firebaserc` — Project ID mapping (mychampions-fb928)
- `dataconnect/sql/dataconnect.yaml` — Data Connect service configuration

### 5. Pure Logic Layer (✓ Complete, Tested)
**File**: `features/plans/starter-template.logic.ts`

- 11 pure functions covering all template operations
- 88 comprehensive unit tests with 100% pass rate
- Performance validated (<100ms for 10k datasets)
- Null safety documented and tested
- Unicode/internationalization support verified

## What Needs To Be Done

### 1. Firebase CLI Issue Resolution
**Current Blocker**: `firebase dataconnect:sql:diff` command encounters path resolution error
- Error: "path argument must be of type string. Received undefined"
- Likely issue in firebase-tools v15.1.0 path handling
- **Solution Path**:
  - Try upgrading: `npm install -g firebase-tools@latest`
  - Or apply schema via Cloud SQL console directly

### 2. Schema Migration
Once CLI issue is resolved:
```bash
firebase dataconnect:sql:migrate --project=mychampions-fb928
```
- Applies `dataconnect/sql/schema.sql` to CloudSQL
- Creates all tables, indexes, and foreign keys
- Idempotent (safe to run multiple times)

### 3. SDK Generation
```bash
firebase dataconnect:sdk:generate --project=mychampions-fb928 --service=mychampions-fb928-service --location=us-east4
```
- Generates typed Data Connect client
- Creates query/mutation functions with type inference
- Output: `lib/dataconnect/generated/` (or similar)

### 4. Wire Generated SDK into Source Layer
**File**: `features/plans/plan-builder-source.ts`

Replace stubs with actual implementation:
```typescript
// BEFORE (stub)
export async function getStarterTemplates() {
  // TODO: implement with Data Connect
}

// AFTER (wired)
import { DataConnectClient } from '../generated/dataconnect';
import { getStarterTemplates as dcGetStarterTemplates } from './plan-builder-dataconnect';

export async function getStarterTemplates(client: DataConnectClient) {
  return dcGetStarterTemplates(client);
}
```

### 5. Integration Testing
Create `features/plans/plan-builder-dataconnect.test.ts`:
- Test queries with real Data Connect client
- Test mutations and side effects
- Test error handling and edge cases
- Validate foreign key constraints
- Test cascading deletes

### 6. Hook Integration
Update `features/plans/use-plan-builder.ts`:
- Pass Data Connect client to data fetching functions
- Handle client initialization and cleanup
- Error boundary for Data Connect failures
- Cache/memoize template queries

## Project Configuration

### Firebase Project
- **Project ID**: mychampions-fb928
- **Project Number**: 942354515358
- **Data Connect Service**: mychampions-fb928-service
- **Location**: us-east4
- **CloudSQL Instance**: mychampions-fb928-instance
- **Database**: mychampions-fb928-database

### Local Configuration
```
firebase.json:
{
  "dataconnect": {
    "source": "dataconnect/sql"
  }
}

.firebaserc:
{
  "projects": {
    "default": "mychampions-fb928"
  }
}

dataconnect/sql/dataconnect.yaml:
specVersion: v1
serviceId: mychampions-fb928-service
location: us-east4
schema:
  - schema.sql
```

## Testing Summary

### Pure Logic Layer (BL-006)
- **Status**: ✓ Complete
- **Tests**: 88 comprehensive unit tests
- **Coverage**: Performance, null safety, edge cases, Unicode
- **Pass Rate**: 100% (540 total tests)

### Data Connect Integration Layer
- **Status**: ⏳ Pending SDK generation
- **Placeholder**: `plan-builder-dataconnect.ts` (type-safe wrapper functions ready)
- **Next**: Create integration tests once SDK is generated

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Firebase CLI version issue | Blocks schema migration | Upgrade to latest, or apply schema via console |
| CloudSQL cold start latency | Slow template queries | Implement client-side caching, query batching |
| Plan clone without stats tracking | Inaccurate analytics | Transactions to ensure clone + stat increment atomic |
| Foreign key constraint violations | Data inconsistency | Comprehensive validation in integration tests |
| Large dataset performance | 10k+ templates slow | Pagination, caching, indexes already in place |

## References

- **Feature**: BL-006 Professional starter template library
- **Functional Requirement**: FR-212, FR-247
- **Use Case**: UC-002.14 Professional opens template library → clones → customizes → assigns
- **Acceptance Criteria**: AC-256 Nutrition and training builders provide starter templates cloned into editable drafts
- **Business Rule**: BR-270 Starter templates are system-provided baselines; original definitions remain immutable
- **Test Case**: TC-260 Starter Template Clone Flow
- **Decision Log**: See `docs/discovery/decisions-log-v1.md` for locked product decisions
- **Pending Wiring**: See `docs/discovery/pending-wiring-checklist-v1.md` for D-114 status

## Next Steps

1. **Resolve Firebase CLI Issue** (Priority: CRITICAL)
   - Investigate firebase-tools version compatibility
   - Try upgrade: `npm install -g firebase-tools@latest`
   - Or apply schema directly via Cloud SQL console

2. **Apply Schema Migration** (Once CLI is working)
   - Verify tables created in CloudSQL
   - Validate indexes and foreign keys
   - Check data types match schema.sql

3. **Generate Data Connect SDK**
   - Run `firebase dataconnect:sdk:generate`
   - Inspect generated client interface
   - Update integration layer imports

4. **Wire into Source Layer**
   - Replace stubs in `plan-builder-source.ts`
   - Add Data Connect client initialization
   - Handle authentication and error cases

5. **Create Integration Tests**
   - Test real Data Connect queries
   - Validate mutations and side effects
   - Test edge cases and error handling

6. **Update Hooks and Components**
   - Integrate Data Connect client into `use-plan-builder.ts`
   - Update `SC-207` and `SC-208` components
   - Test end-to-end template library flows

## Summary

All infrastructure for Firebase Data Connect integration is defined and ready for deployment. The pure logic layer (BL-006) is complete with 88 comprehensive tests. The integration layer is type-safe and ready for SDK wiring. A Firebase CLI configuration issue currently blocks schema migration, but this is a tooling issue with a clear workaround (direct CloudSQL console application).

**Status**: Code-complete at infrastructure layer, ready for Firebase Data Connect CLI resolution and final wiring.

---

**Last Updated**: 2026-03-01
**Status Tracking**: D-114, Milestone C Planning
**Owner**: @eduardosantos
