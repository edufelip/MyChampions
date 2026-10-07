import {
  EXPLORATION_MAX_DURATION_MINUTES,
  EXPLORATION_MAX_UI_ACTIONS,
  EXPLORATION_UNCHANGED_FAILURE_LIMIT,
} from './prepare-exploration';

export type ExplorationStopReason =
  'duration-limit' | 'action-limit' | 'unchanged-failure-limit' | 'cancelled' | 'invalid-clock';

export type ExplorationActionOutcome = 'passed' | 'failed' | 'blocked' | 'cancelled';
export type ExplorationActionKey = {
  branchId: string;
  inputSha256: string;
  observationSha256: string;
};
export type ExplorationActionPermit = Readonly<{ sequence: number }>;

/** Policy only: permits are not observations, qualifications, or passing receipts. */
export class ExplorationBudgetPolicy {
  private readonly started: number;
  private previousTime: number;
  private issued = 0;
  private settled = 0;
  private stopped: ExplorationStopReason | null = null;
  private pending: { permit: ExplorationActionPermit; key: ExplorationActionKey } | null = null;
  private readonly failures = new Map<string, { fingerprint: string; count: number }>();

  constructor(private readonly monotonicNow: () => number = () => performance.now()) {
    const now = monotonicNow();
    if (!Number.isFinite(now) || now < 0) throw new Error('Invalid exploration monotonic clock');
    this.started = now;
    this.previousTime = now;
  }

  private tick(): void {
    if (this.stopped) return;
    const now = this.monotonicNow();
    if (!Number.isFinite(now) || now < this.previousTime) {
      this.stopped = 'invalid-clock';
      return;
    }
    this.previousTime = now;
    if (now - this.started >= EXPLORATION_MAX_DURATION_MINUTES * 60 * 1000)
      this.stopped = 'duration-limit';
  }

  private requireKey(key: ExplorationActionKey): void {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key.branchId) ||
      !/^[a-f0-9]{64}$/.test(key.inputSha256) ||
      !/^[a-f0-9]{64}$/.test(key.observationSha256)
    )
      throw new Error('Exploration action requires a branch and semantic input/observation hashes');
  }

  /** Call immediately before invoking an actual UI action, including qualification navigation. */
  beginAction(key: ExplorationActionKey): ExplorationActionPermit | null {
    this.requireKey(key);
    this.tick();
    if (this.stopped) return null;
    if (this.pending) throw new Error('Exploration action is already in flight');
    if (this.issued >= EXPLORATION_MAX_UI_ACTIONS) {
      this.stopped = 'action-limit';
      return null;
    }
    const fingerprint = `${key.inputSha256}:${key.observationSha256}`;
    const previous = this.failures.get(key.branchId);
    if (
      previous?.fingerprint === fingerprint &&
      previous.count >= EXPLORATION_UNCHANGED_FAILURE_LIMIT
    ) {
      this.stopped = 'unchanged-failure-limit';
      return null;
    }
    const permit = Object.freeze({ sequence: ++this.issued });
    this.pending = { permit, key: { ...key } };
    return permit;
  }

  /** Late outcomes still count; this does not clear a stop or authorize another action. */
  finishAction(permit: ExplorationActionPermit, outcome: ExplorationActionOutcome): void {
    if (!this.pending || this.pending.permit !== permit)
      throw new Error('Exploration completion has no matching outstanding action');
    if (!['passed', 'failed', 'blocked', 'cancelled'].includes(outcome))
      throw new Error('Unknown exploration action outcome');
    this.tick();
    if (outcome === 'cancelled' && !this.stopped) this.stopped = 'cancelled';
    const { key } = this.pending;
    const fingerprint = `${key.inputSha256}:${key.observationSha256}`;
    if (outcome === 'passed') this.failures.delete(key.branchId);
    else {
      const prior = this.failures.get(key.branchId);
      const count = prior?.fingerprint === fingerprint ? prior.count + 1 : 1;
      this.failures.set(key.branchId, {
        fingerprint,
        count,
      });
      if (count >= EXPLORATION_UNCHANGED_FAILURE_LIMIT && !this.stopped)
        this.stopped = 'unchanged-failure-limit';
    }
    this.pending = null;
    this.settled++;
    if (this.issued >= EXPLORATION_MAX_UI_ACTIONS && !this.stopped) this.stopped = 'action-limit';
  }

  cancel(): void {
    this.tick();
    if (!this.stopped) this.stopped = 'cancelled';
  }

  snapshot() {
    this.tick();
    return Object.freeze({
      issuedActions: this.issued,
      settledActions: this.settled,
      inFlight: this.pending !== null,
      stopReason: this.stopped,
    });
  }
}
