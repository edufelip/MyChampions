/**
 * Safe, policy-free reads from unknown error or wire objects.
 *
 * Domain mappers must not coerce arbitrary values or inspect diagnostic
 * messages.  Reading own data-property descriptors also means a hostile
 * getter cannot execute while an error is being classified.
 */

export type SafeField = {
  present: boolean;
  readable: boolean;
  value?: unknown;
};

export function isSafeRecord(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

export function readOwnField(value: unknown, key: string): SafeField {
  if (!isSafeRecord(value)) {
    return { present: false, readable: false };
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return { present: false, readable: false };
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return { present: true, readable: false };
    }
    return { present: true, readable: true, value: descriptor.value };
  } catch {
    return { present: true, readable: false };
  }
}

/** Returns a bounded string without calling String() on an untrusted value. */
export function readBoundedString(value: unknown, maxLength = 128): string | null {
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

export function isSafeInstanceOf<T extends object>(
  value: unknown,
  constructor: new (...args: never[]) => T,
): value is T {
  try {
    return value instanceof constructor;
  } catch {
    return false;
  }
}
