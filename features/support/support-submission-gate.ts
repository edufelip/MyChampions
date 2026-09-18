export type SupportSubmissionGate = {
  tryAcquire(): boolean;
  release(): void;
};

export function createSupportSubmissionGate(): SupportSubmissionGate {
  let locked = false;

  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
  };
}
