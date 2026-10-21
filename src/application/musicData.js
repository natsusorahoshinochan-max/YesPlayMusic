import { configureMetadataReads } from '@/api/readingContext';
import { configureTrackCache } from '@/utils/db';

export function configureMusicData({
  getSettings,
  getIdentity,
  ...cacheOptions
}) {
  configureMetadataReads({ getIdentity });
  configureTrackCache({
    ...cacheOptions,
    getLimitBytes() {
      const limit = getSettings().cacheLimit;
      return limit === false ? false : limit * Math.pow(1024, 2);
    },
  });
}
