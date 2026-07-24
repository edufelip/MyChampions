import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { impactAsync, notificationAsync } from './haptics-adapter.web';
import {
  resolveBrowserPhoto,
  resolveCompressedPhotoSize,
} from './photo-picker-adapter.web';
import {
  isBrowserCameraAvailable,
  requestBrowserCameraPermission,
} from './qr-scanner-adapter.web';
import { createWebShareAdapter } from './share-adapter.web';

describe('web photo picker adapter', () => {
  it('treats an empty file selection as provider cancellation', async () => {
    let created = false;
    const photo = await resolveBrowserPhoto(undefined, {
      createObjectUrl: () => {
        created = true;
        return 'blob:unused';
      },
      readDimensions: async () => ({ width: 1, height: 1 }),
      revokeObjectUrl: () => {},
    });

    assert.equal(photo, null);
    assert.equal(created, false);
  });

  it('loads browser photo dimensions and revokes unreadable object URLs', async () => {
    const file = {} as File;
    assert.deepEqual(
      await resolveBrowserPhoto(file, {
        createObjectUrl: () => 'blob:photo',
        readDimensions: async () => ({ width: 1200, height: 800 }),
        revokeObjectUrl: () => assert.fail('successful photos remain available for compression'),
      }),
      { uri: 'blob:photo', width: 1200, height: 800 }
    );

    let revoked: string | null = null;
    assert.equal(
      await resolveBrowserPhoto(file, {
        createObjectUrl: () => 'blob:broken',
        readDimensions: async () => {
          throw new Error('decode_failed');
        },
        revokeObjectUrl: (uri) => {
          revoked = uri;
        },
      }),
      null
    );
    assert.equal(revoked, 'blob:broken');
  });

  it('constrains the longest side without enlarging smaller photos', () => {
    assert.deepEqual(resolveCompressedPhotoSize({ uri: 'a', width: 3200, height: 1600 }), {
      width: 1600,
      height: 800,
    });
    assert.deepEqual(resolveCompressedPhotoSize({ uri: 'b', width: 640, height: 480 }), {
      width: 640,
      height: 480,
    });
  });

  it('keeps browser cancellation and object URL cleanup in the picker boundary', () => {
    const source = readFileSync(new URL('./photo-picker-adapter.web.ts', import.meta.url).pathname, 'utf8');
    assert.doesNotMatch(source, /setAttribute\(['"]capture['"]/);
    assert.match(source, /addEventListener\(['"]cancel['"]/);
    assert.match(source, /removeEventListener\(['"]focus['"]/);
    assert.match(source, /finally\s*\{[\s\S]*revokeObjectURL/);
  });

  it('keeps native photo picker action-sheet copy injected by localized callers', () => {
    const source = readFileSync(new URL('./photo-picker-adapter.ts', import.meta.url).pathname, 'utf8');
    assert.match(source, /copy\.title/);
    assert.match(source, /copy\.chooseFromLibrary/);
    assert.doesNotMatch(source, /['"]Choose a photo source['"]/);
  });

  it('keeps native permission denial distinct from picker cancellation', () => {
    const source = readFileSync(new URL('./photo-picker-adapter.ts', import.meta.url).pathname, 'utf8');
    assert.match(source, /class PhotoPickerPermissionDeniedError/);
    assert.match(source, /if \(!permission\.granted\) throw new PhotoPickerPermissionDeniedError\(source\)/);
    assert.match(source, /\.then\(resolve, reject\)/);
  });
});

describe('web QR scanner adapter', () => {
  it('reports unavailable camera APIs and fails permission closed', async () => {
    assert.equal(isBrowserCameraAvailable(undefined), false);
    assert.equal(await requestBrowserCameraPermission(undefined), false);
  });

  it('handles denied permission and stops a granted probe stream', async () => {
    assert.equal(
      await requestBrowserCameraPermission({
        getUserMedia: async () => {
          throw new Error('NotAllowedError');
        },
      } as Pick<MediaDevices, 'getUserMedia'>),
      false
    );

    let stopped = false;
    const granted = await requestBrowserCameraPermission({
      getUserMedia: async () =>
        ({
          getTracks: () => [{ stop: () => (stopped = true) }],
        }) as unknown as MediaStream,
    } as Pick<MediaDevices, 'getUserMedia'>);
    assert.equal(granted, true);
    assert.equal(stopped, true);
  });
});

describe('web share adapter', () => {
  it('uses Web Share first and falls back to the clipboard on provider failure', async () => {
    const clipboard: string[] = [];
    const shared: ShareData[] = [];
    const adapter = createWebShareAdapter({
      share: async (data) => {
        shared.push(data);
        throw new Error('share_failed');
      },
      writeClipboard: async (message) => {
        clipboard.push(message);
      },
      openWindow: () => ({}),
      isAbortError: () => false,
    });

    await adapter.shareText('invite', 'MyChampions');
    assert.deepEqual(shared, [{ text: 'invite', title: 'MyChampions' }]);
    assert.deepEqual(clipboard, ['invite']);
  });

  it('treats provider cancellation as complete and exposes missing clipboard support', async () => {
    let clipboardCalled = false;
    const cancelled = createWebShareAdapter({
      share: async () => {
        throw new Error('cancelled');
      },
      writeClipboard: async () => {
        clipboardCalled = true;
      },
      openWindow: () => ({}),
      isAbortError: () => true,
    });
    await cancelled.shareText('invite');
    assert.equal(clipboardCalled, false);

    const unavailable = createWebShareAdapter({
      openWindow: () => ({}),
      isAbortError: () => false,
    });
    await assert.rejects(unavailable.shareText('invite'), /clipboard_unavailable/);
  });

  it('opens safe external links exactly once and rejects unsafe schemes', async () => {
    const opened: string[] = [];
    const adapter = createWebShareAdapter({
      openWindow: (url) => opened.push(url),
      isAbortError: () => false,
    });
    await adapter.openExternalLink('https://example.test');
    assert.deepEqual(opened, ['https://example.test']);
    await assert.rejects(adapter.openExternalLink('javascript:alert(1)'), /unsafe_external_url/);
  });
});

describe('web haptics and platform selection', () => {
  it('keeps browser haptics as safe no-ops', async () => {
    await impactAsync();
    await notificationAsync();
  });

  it('keeps native and web implementations behind platform module pairs', () => {
    for (const adapter of ['photo-picker-adapter', 'qr-scanner-adapter', 'share-adapter', 'haptics-adapter']) {
      assert.doesNotThrow(() =>
        readFileSync(new URL(`./${adapter}.ts`, import.meta.url).pathname, 'utf8')
      );
      assert.doesNotThrow(() =>
        readFileSync(new URL(`./${adapter}.web.ts`, import.meta.url).pathname, 'utf8')
      );
    }
  });
});
