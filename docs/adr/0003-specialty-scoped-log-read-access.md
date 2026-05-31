# Specialty-scoped Firestore read access for tracking logs

A Professional's read access to a Student's tracking logs is scoped by Specialty: an active `nutritionist` Connection grants read access to `mealLogs` only; an active `fitness_coach` Connection grants read access to `workoutLogs` only. Any active Connection being sufficient to read all log types was rejected — it would allow a disconnected coach to retain nutrition log access through a surviving nutritionist connection, and vice versa.

**Consequences:**
- Firestore security rules for `mealLogs` must verify an active `nutritionist` Connection between the reader and the document owner, not just any active Connection.
- Firestore security rules for `workoutLogs` must verify an active `fitness_coach` Connection.
- Current rules likely perform a single connection existence check — they must be updated to filter by `specialty` field on the Connection document.
