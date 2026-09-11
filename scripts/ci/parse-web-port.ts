const minimumWebPort = 1;
const maximumWebPort = 65_535;

export function parseWebPort(name: string, value: string | undefined, fallback: number): number {
  const rawValue = value ?? String(fallback);
  if (!/^[0-9]+$/.test(rawValue)) {
    throw new Error(`${name} must contain only decimal digits`);
  }

  const port = Number(rawValue);
  if (!Number.isSafeInteger(port) || port < minimumWebPort || port > maximumWebPort) {
    throw new Error(`${name} must be an integer from ${minimumWebPort} to ${maximumWebPort}`);
  }
  return port;
}
