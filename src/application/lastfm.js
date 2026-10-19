import { auth, authGetSession } from '@/api/lastfm';
import { createLastfmStorage } from './lastfmStorage';
import { createLastfmExchange } from './lastfmExchange';

export function createLastfmOptions(storage) {
  const authorizationStorage = createLastfmStorage(storage);
  return {
    storage: authorizationStorage,
    auth,
    authGetSession,
    exchange: createLastfmExchange({ storage: authorizationStorage }),
  };
}
