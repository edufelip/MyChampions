import { execFile } from 'node:child_process';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const bundle = 'com.edufelip.mychampions.dev';
const localApplicationId = `MCLOCALQA1.${bundle}`;

export function assertSimulatorAppMetadata(platform: string, bundleId: string) {
  if (platform !== 'iphonesimulator' || bundleId !== bundle)
    throw new Error(
      'Local signing requires the dev iOS simulator app; device/release apps are rejected',
    );
}

/** Reads Xcode's simulated entitlements section, not restricted host signature grants. */
export function readSimulatedEntitlements(binary: Buffer) {
  if (binary.length < 32 || binary.readUInt32LE(0) !== 0xfeedfacf)
    throw new Error('Simulator entitlement reader requires a little-endian 64-bit Mach-O');
  const count = binary.readUInt32LE(16);
  const limit = 32 + binary.readUInt32LE(20);
  if (limit > binary.length || count > 1024) throw new Error('Invalid Mach-O command bounds');
  let cursor = 32;
  let platform: number | undefined;
  let entitlements: Buffer | undefined;
  const name = (offset: number) =>
    binary
      .subarray(offset, offset + 16)
      .toString('ascii')
      .split('\0')[0];
  for (let i = 0; i < count; i++) {
    if (cursor + 8 > limit) throw new Error('Invalid Mach-O command bounds');
    const command = binary.readUInt32LE(cursor);
    const size = binary.readUInt32LE(cursor + 4);
    if (size < 8 || cursor + size > limit) throw new Error('Invalid Mach-O command bounds');
    if (command === 0x32) {
      if (size < 24) throw new Error('Invalid Mach-O build version');
      platform = binary.readUInt32LE(cursor + 8);
    }
    if (command === 0x19) {
      if (size < 72) throw new Error('Invalid Mach-O segment');
      const sections = binary.readUInt32LE(cursor + 64);
      if (72 + sections * 80 > size) throw new Error('Invalid Mach-O section bounds');
      for (let j = 0; j < sections; j++) {
        const section = cursor + 72 + j * 80;
        if (name(section) !== '__entitlements' || name(section + 16) !== '__TEXT') continue;
        const length = Number(binary.readBigUInt64LE(section + 40));
        const offset = binary.readUInt32LE(section + 48);
        if (
          !length ||
          length > 64 * 1024 ||
          offset < limit ||
          offset + length > binary.length ||
          entitlements
        )
          throw new Error('Invalid or duplicate simulated entitlement section');
        entitlements = binary.subarray(offset, offset + length);
      }
    }
    cursor += size;
  }
  if (cursor !== limit || platform !== 7) throw new Error('Mach-O is not an iOS simulator binary');
  if (!entitlements) throw new Error('Simulator binary has no embedded simulated entitlements');
  return entitlements.toString('utf8').replace(/\0+$/, '');
}

async function assertPrivateRoot(artifactRoot: string) {
  const info = await lstat(artifactRoot);
  if (
    (await realpath(artifactRoot)) !== artifactRoot ||
    !info.isDirectory() ||
    (info.mode & 0o777) !== 0o700 ||
    info.uid !== process.getuid?.()
  )
    throw new Error('Simulator build requires private owned artifacts');
}

/** Xcode embeds these in __TEXT,__entitlements for the simulator. Never codesign them as host grants. */
export async function writeSimulatorBuildEntitlements(artifactRoot: string) {
  await assertPrivateRoot(artifactRoot);
  const entitlementsPath = path.join(artifactRoot, 'simulator-only.entitlements');
  await writeFile(
    entitlementsPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>application-identifier</key><string>${localApplicationId}</string><key>keychain-access-groups</key><array><string>${localApplicationId}</string></array></dict></plist>\n`,
    { mode: 0o600, flag: 'wx' },
  );
  return entitlementsPath;
}

export async function verifyIosSimulatorApp(binary: string, artifactRoot: string) {
  await assertPrivateRoot(artifactRoot);
  if ((await realpath(binary)) !== binary) throw new Error('Simulator build path is not canonical');
  const plist = async (field: string, file = path.join(binary, 'Info.plist')) =>
    (
      await execute('/usr/libexec/PlistBuddy', ['-c', `Print :${field}`, file], { timeout: 5000 })
    ).stdout.trim();
  assertSimulatorAppMetadata(await plist('DTPlatformName'), await plist('CFBundleIdentifier'));
  const executable = await plist('CFBundleExecutable');
  if (path.basename(executable) !== executable)
    throw new Error('Invalid simulator executable path');
  const observed = path.join(artifactRoot, 'observed-simulated-entitlements.plist');
  await writeFile(
    observed,
    readSimulatedEntitlements(await readFile(path.join(binary, executable))),
    { mode: 0o600 },
  );
  for (const field of ['application-identifier', 'keychain-access-groups:0'])
    if ((await plist(field, observed)) !== localApplicationId)
      throw new Error('Embedded simulator keychain identity mismatch');
  await execute('codesign', ['--verify', '--strict', binary], { timeout: 30_000 });
  return {
    binaryPath: binary,
    signingProfile:
      'Xcode local ad-hoc simulator build with embedded simulated entitlements; no release qualification',
    localApplicationId,
  };
}
