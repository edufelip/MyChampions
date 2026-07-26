import { Linking, Share } from 'react-native';

export type ShareAdapter = {
  shareText: (message: string, title?: string) => Promise<void>;
  openExternalLink: (url: string) => Promise<void>;
};

export const shareAdapter: ShareAdapter = {
  shareText: async (message, title) => {
    await Share.share({ message, title });
  },
  openExternalLink: (url) => Linking.openURL(url),
};
