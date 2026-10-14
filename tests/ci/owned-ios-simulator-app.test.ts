import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertSimulatorAppMetadata,
  readSimulatedEntitlements,
  writeSimulatorBuildEntitlements,
} from '../../scripts/testing/owned-ios-simulator-app';

void test('local simulator signing rejects device and production metadata before mutation', () => {
  assert.doesNotThrow(() =>
    assertSimulatorAppMetadata('iphonesimulator', 'com.edufelip.mychampions.dev'),
  );
  assert.throws(
    () => assertSimulatorAppMetadata('iphoneos', 'com.edufelip.mychampions.dev'),
    /device\/release/,
  );
  assert.throws(
    () => assertSimulatorAppMetadata('iphonesimulator', 'com.edufelip.mychampions'),
    /device\/release/,
  );
});

void test('simulator build refuses a public artifact directory before writing entitlement input', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-simulator-sign-')));
  try {
    await chmod(directory, 0o755);
    await assert.rejects(writeSimulatorBuildEntitlements(directory), /private owned/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('embedded simulated entitlement reader rejects missing sections, device targets and malformed offsets', () => {
  const xml = Buffer.from(
    '<plist><dict><key>application-identifier</key><string>test</string></dict></plist>',
  );
  const commandSize = 152 + 24;
  const offset = 32 + commandSize;
  const bytes = Buffer.alloc(offset + xml.length);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(2, 16);
  bytes.writeUInt32LE(commandSize, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(152, 36);
  bytes.writeUInt32LE(1, 96);
  bytes.write('__entitlements', 104);
  bytes.write('__TEXT', 120);
  bytes.writeBigUInt64LE(BigInt(xml.length), 144);
  bytes.writeUInt32LE(offset, 152);
  bytes.writeUInt32LE(0x32, 184);
  bytes.writeUInt32LE(24, 188);
  bytes.writeUInt32LE(7, 192);
  xml.copy(bytes, offset);
  assert.equal(readSimulatedEntitlements(bytes), xml.toString());
  const device = Buffer.from(bytes);
  device.writeUInt32LE(2, 192);
  assert.throws(() => readSimulatedEntitlements(device), /not an iOS simulator/);
  const missing = Buffer.from(bytes);
  missing.fill(0, 104, 120);
  assert.throws(() => readSimulatedEntitlements(missing), /no embedded/);
  const escape = Buffer.from(bytes);
  escape.writeUInt32LE(bytes.length + 1, 152);
  assert.throws(() => readSimulatedEntitlements(escape), /Invalid/);
  const malformed = Buffer.from(bytes);
  malformed.writeUInt32LE(4, 36);
  assert.throws(() => readSimulatedEntitlements(malformed), /bounds/);
});
