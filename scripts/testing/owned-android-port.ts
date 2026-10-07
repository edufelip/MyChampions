import { createServer } from 'node:net';

/** ADB scans adbd ports while we reserve them. Drain incoming sockets immediately. */
export async function reserveOwnedAndroidPort(requestedPort: number) {
  if (!Number.isSafeInteger(requestedPort) || requestedPort < 1024 || requestedPort > 49151)
    throw new Error('Invalid Android reservation port');
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', resolve);
  });
  let released: Promise<void> | undefined;
  return {
    port: requestedPort,
    release() {
      released ??= new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      return released;
    },
  };
}
