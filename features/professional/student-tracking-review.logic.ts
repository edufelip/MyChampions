import type { PortionLog } from '../nutrition/custom-meal-source';
import type { WaterIntakeLog } from '../nutrition/water-tracking.logic';

export type StudentTrackingReview = {
  todayWater: {
    dateKey: string;
    totalMl: number;
    goalMl: number | null;
    progressPercent: number | null;
  };
  sevenDayHydration: Array<{
    dateKey: string;
    totalMl: number;
    goalMet: boolean | null;
  }>;
  todayMealCheckOffs: Array<{
    mealId: string;
    loggedAt: string;
    calories: number;
    planId: string | null;
    connectionId: string | null;
  }>;
  recentPortionLogs: PortionLog[];
};

export function buildStudentTrackingReview(input: {
  todayKey: string;
  waterGoalMl: number | null;
  waterLogs: WaterIntakeLog[];
  portionLogs: PortionLog[];
}): StudentTrackingReview {
  const dateKeys = buildDateKeys(input.todayKey, 7);
  const waterByDate = new Map(input.waterLogs.map((log) => [log.dateKey, log]));
  const todayWaterLog = waterByDate.get(input.todayKey);
  const todayWaterTotal = todayWaterLog?.totalMl ?? 0;

  const recentPortionLogs = input.portionLogs
    .filter((log) => dateKeys.includes(log.loggedAt.slice(0, 10)))
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));

  return {
    todayWater: {
      dateKey: input.todayKey,
      totalMl: todayWaterTotal,
      goalMl: input.waterGoalMl,
      progressPercent:
        input.waterGoalMl && input.waterGoalMl > 0
          ? Math.min(Math.round((todayWaterTotal / input.waterGoalMl) * 100), 100)
          : null,
    },
    sevenDayHydration: dateKeys.map((dateKey) => {
      const totalMl = waterByDate.get(dateKey)?.totalMl ?? 0;
      return {
        dateKey,
        totalMl,
        goalMet: input.waterGoalMl && input.waterGoalMl > 0 ? totalMl >= input.waterGoalMl : null,
      };
    }),
    todayMealCheckOffs: recentPortionLogs
      .filter((log) => log.loggedAt.slice(0, 10) === input.todayKey)
      .map((log) => ({
        mealId: log.mealId,
        loggedAt: log.loggedAt,
        calories: log.snapshot.calories,
        planId: log.planId ?? null,
        connectionId: log.connectionId ?? null,
      })),
    recentPortionLogs,
  };
}

export function buildDateKeys(todayKey: string, count: number): string[] {
  const start = new Date(`${todayKey}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getTime() - index * 86_400_000);
    return date.toISOString().slice(0, 10);
  });
}
