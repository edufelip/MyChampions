import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStudentTrackingReview } from './student-tracking-review.logic';

test('buildStudentTrackingReview shows today water progress and seven-day hydration summary', () => {
  const review = buildStudentTrackingReview({
    todayKey: '2026-06-01',
    waterGoalMl: 2000,
    waterLogs: [
      { id: 'w1', dateKey: '2026-06-01', totalMl: 1500, loggedAt: '2026-06-01T10:00:00.000Z' },
      { id: 'w2', dateKey: '2026-05-31', totalMl: 2200, loggedAt: '2026-05-31T10:00:00.000Z' },
      { id: 'w3', dateKey: '2026-05-26', totalMl: 1800, loggedAt: '2026-05-26T10:00:00.000Z' },
      { id: 'old', dateKey: '2026-05-24', totalMl: 2400, loggedAt: '2026-05-24T10:00:00.000Z' },
    ],
    portionLogs: [],
  });

  assert.equal(review.todayWater.totalMl, 1500);
  assert.equal(review.todayWater.goalMl, 2000);
  assert.equal(review.todayWater.progressPercent, 75);
  assert.deepEqual(review.sevenDayHydration.map((day) => day.dateKey), [
    '2026-06-01',
    '2026-05-31',
    '2026-05-30',
    '2026-05-29',
    '2026-05-28',
    '2026-05-27',
    '2026-05-26',
  ]);
  assert.equal(review.sevenDayHydration[1].goalMet, true);
  assert.equal(review.sevenDayHydration[6].totalMl, 1800);
});

test('buildStudentTrackingReview shows today meal check-offs and recent seven-day portion logs', () => {
  const review = buildStudentTrackingReview({
    todayKey: '2026-06-01',
    waterGoalMl: null,
    waterLogs: [],
    portionLogs: [
      {
        id: 'today-1',
        ownerUid: 'student-uid',
        mealId: 'breakfast',
        consumedGrams: 0,
        snapshot: { calories: 300, carbs: 32, proteins: 20, fats: 8 },
        loggedAt: '2026-06-01T08:00:00.000Z',
        planId: 'plan-1',
        planType: 'nutrition',
        sourceKind: 'assigned',
        ownerProfessionalUid: 'nutritionist-uid',
        connectionId: 'connection-1',
      },
      {
        id: 'recent-1',
        ownerUid: 'student-uid',
        mealId: 'dinner',
        consumedGrams: 0,
        snapshot: { calories: 500, carbs: 40, proteins: 35, fats: 15 },
        loggedAt: '2026-05-30T18:00:00.000Z',
        planId: null,
        planType: null,
        sourceKind: null,
        ownerProfessionalUid: null,
        connectionId: null,
      },
      {
        id: 'old-1',
        ownerUid: 'student-uid',
        mealId: 'old',
        consumedGrams: 0,
        snapshot: { calories: 100, carbs: 10, proteins: 10, fats: 1 },
        loggedAt: '2026-05-24T18:00:00.000Z',
        planId: null,
        planType: null,
        sourceKind: null,
        ownerProfessionalUid: null,
        connectionId: null,
      },
    ],
  });

  assert.deepEqual(review.todayMealCheckOffs, [
    {
      mealId: 'breakfast',
      loggedAt: '2026-06-01T08:00:00.000Z',
      calories: 300,
      planId: 'plan-1',
      connectionId: 'connection-1',
    },
  ]);
  assert.deepEqual(review.recentPortionLogs.map((log) => log.id), ['today-1', 'recent-1']);
});
