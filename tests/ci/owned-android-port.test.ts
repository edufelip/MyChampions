import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import test from 'node:test';
import { reserveOwnedAndroidPort } from '../../scripts/testing/owned-android-port';

async function availableReservation() {
  for (let count = 0; count < 50; count++) {
    try {
      return await reserveOwnedAndroidPort(randomInt(30_000, 40_000));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No Android test port available');
}

void test('Android reservation drains an ADB-like connection before release and is idempotent', async () => {
  const reservation = await availableReservation();
  const client = createConnection({ host: '127.0.0.1', port: reservation.port });
  client.on('error', () => undefined);
  const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
  const connected = new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('error', reject);
  });
  try {
    await connected;
    // ADB sends a connection packet and can keep the socket open during discovery.
    client.write('CNXN');
    const releasing = reservation.release();
    assert.equal(reservation.release(), releasing);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        releasing,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('reservation drain deadline')), 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    await closed;
  } finally {
    client.destroy();
    await reservation.release();
  }
});

void test('Android reservation cannot adopt an occupied foreign listener', async () => {
  const reservation = await availableReservation();
  const port = reservation.port;
  await reservation.release();
  const foreign = createServer((socket) => socket.end('foreign'));
  await new Promise<void>((resolve, reject) => {
    foreign.once('error', reject);
    foreign.listen(port, '127.0.0.1', resolve);
  });
  const address = foreign.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await assert.rejects(reserveOwnedAndroidPort(address.port), /EADDRINUSE/);
    assert.equal(foreign.listening, true);
    await assert.rejects(reserveOwnedAndroidPort(503), /Invalid Android reservation port/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      foreign.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
