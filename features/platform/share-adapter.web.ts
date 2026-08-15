import { allowInsecureLocalhostForDevelopment, resolveSafeExternalUrl } from './external-url';
import type { ShareAdapter } from './share-adapter';

export type WebShareDependencies = {
  share?: (data: ShareData) => Promise<void>;
  writeClipboard?: (message: string) => Promise<void>;
  // Returns the opened window, or a falsy value when the browser blocked the
  // popup — the caller uses this to surface a recoverable error instead of
  // silently reporting success.
  openWindow: (url: string) => unknown;
  isAbortError: (error: unknown) => boolean;
};

export function createWebShareAdapter(deps: WebShareDependencies): ShareAdapter {
  return {
    shareText: async (message, title) => {
      if (deps.share) {
        try {
          await deps.share({ text: message, title });
          return;
        } catch (error) {
          if (deps.isAbortError(error)) return;
        }
      }
      if (!deps.writeClipboard) throw new Error('clipboard_unavailable');
      await deps.writeClipboard(message);
    },
    openExternalLink: async (url) => {
      const safeUrl = resolveSafeExternalUrl(url, {
        allowInsecureLocalhost: allowInsecureLocalhostForDevelopment(),
      });
      if (!safeUrl) throw new Error('unsafe_external_url');
      const opened = deps.openWindow(safeUrl);
      if (!opened) throw new Error('popup_blocked');
    },
  };
}

export const shareAdapter = createWebShareAdapter({
  share: typeof navigator === 'undefined' ? undefined : navigator.share?.bind(navigator),
  writeClipboard:
    typeof navigator === 'undefined'
      ? undefined
      : navigator.clipboard?.writeText.bind(navigator.clipboard),
  openWindow: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
  isAbortError: (error) =>
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError',
});
