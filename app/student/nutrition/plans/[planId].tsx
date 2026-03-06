/**
 * Student self-guided nutrition plan builder entrypoint.
 * Route: /student/nutrition/plans/:planId
 *
 * Temporary implementation reuses SC-207 builder surface while we keep
 * one shared plan-building engine for both roles.
 */
export { default } from '@/app/professional/nutrition/plans/[planId]';
