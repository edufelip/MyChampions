import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ServerAuthStorage } from './server-auth-source';

export const serverAuthStorage: ServerAuthStorage = AsyncStorage;
