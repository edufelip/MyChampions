import type { ServerAuthStorage } from './server-auth-source';

export const serverAuthStorage: ServerAuthStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};
