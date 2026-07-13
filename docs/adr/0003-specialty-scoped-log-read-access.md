# Specialty-scoped server read access for tracking logs

A Professional's read access to a Student's tracking logs is scoped by Specialty: an active `nutritionist` Connection grants read access to `mealLogs` only; an active `fitness_coach` Connection grants read access to `workoutLogs` only. Any active Connection being sufficient to read all log types was rejected — it would allow a disconnected coach to retain nutrition log access through a surviving nutritionist connection, and vice versa.

**Consequences:**
- MyChampions server tracking-review routes must verify an active `nutritionist` Connection before returning meal/portion/hydration logs.
- MyChampions server workout-log review routes must verify an active `fitness_coach` Connection before returning workout logs.
- Repository access checks must filter by `specialty` on the server-owned Connection row, not by a generic connection existence check.
