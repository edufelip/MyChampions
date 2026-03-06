/**
 * Student self-guided training plan builder entrypoint.
 * Route: /student/training/plans/:planId
 *
 * Temporary implementation reuses SC-208 builder surface while we keep
 * one shared plan-building engine for both roles.
 */
export { default } from '@/app/professional/training/plans/[planId]';
