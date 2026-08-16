export type AuthSubmissionGate = {
  tryAcquire: () => boolean;
  release: () => void;
};

export function createAuthSubmissionGate(): AuthSubmissionGate {
  let isLocked = false;

  return {
    tryAcquire() {
      if (isLocked) return false;
      isLocked = true;
      return true;
    },
    release() {
      isLocked = false;
    },
  };
}
