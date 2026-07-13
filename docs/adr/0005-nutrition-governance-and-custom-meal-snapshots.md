# Nutrition governance and CustomMeal snapshots

NutritionPlan governance matches TrainingPlan governance: student-authored nutrition plans are Self-Managed Plans, draft assigned NutritionPlans are invisible to Students, active nutritionist Connections block self-managed nutrition editing, and assigned NutritionPlans require an active nutritionist Connection. We chose strict governance over same-user `predefined` compatibility because the app is not live and the corrected model is safer for rules, lifecycle, and product language.

CustomMeals remain user-owned reusable meals/recipes. They can be included in NutritionPlans only as stable meal snapshots, not as direct access to another user's reusable CustomMeal record; Professionals cannot add Student-owned CustomMeals to assigned plans unless the Student first shares/copies the meal, and Students logging CustomMeals expose nutritionist-visible log snapshots rather than the private reusable record.

**Consequences:**
- Existing retired provider data shapes do not need migration or compatibility paths before release.
- Nutrition plan server routes/repositories must mirror the explicit source-kind, draft visibility, active-specialty, assignment, delete, and lifecycle constraints already used for training plans.
- Nutrition tracking logs remain Student-owned but may include plan/Connection provenance for review and audit.
- Nutritionist tracking review belongs on the Professional Student Profile and is read-only.
