import type { ShareAdapter } from './share-adapter';
import { allowInsecureLocalhostForDevelopment, resolveSafeExternalUrl } from './external-url';

export type WebShareDependencies = {
  share?: (data: ShareData) => Promise<void>;
  writeClipboard?: (message: string) => Promise<void>;
  openWindow: (url: string) => void;
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
      deps.openWindow(safeUrl);
    },
  };
}

export const shareAdapter = createWebShareAdapter({
  share: typeof navigator === 'undefined' ? undefined : navigator.share?.bind(navigator),
  writeClipboard:
    typeof navigator === 'undefined'
      ? undefined
      : navigator.clipboard?.writeText.bind(navigator.clipboard),
  openWindow: (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  isAbortError: (error) =>
    typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError',
});
