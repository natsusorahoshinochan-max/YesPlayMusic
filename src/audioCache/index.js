const byteSize = row => row?.source?.byteLength || 0;

export function createAudioCache({
  db,
  download,
  getLimitBytes = () => false,
}) {
  let size = null;
  let commits = Promise.resolve();
  const enqueue = operation => {
    const result = commits.then(operation);
    commits = result.catch(() => {});
    return result;
  };
  const scan = async () => {
    const rows = await db.trackSources.toArray();
    return {
      bytes: rows.reduce((sum, row) => sum + byteSize(row), 0),
      length: rows.length,
    };
  };
  const evict = async next => {
    const limit = getLimitBytes();
    if (limit === false) return;
    const rows = await db.trackSources.orderBy('createTime').toArray();
    for (const row of rows) {
      if (next.bytes <= limit) break;
      await db.trackSources.delete(row.id);
      next.bytes -= byteSize(row);
      next.length--;
    }
  };

  return {
    clearDB() {
      return enqueue(async () => {
        await db.transaction('rw', db.tables, async () => {
          for (const table of db.tables) await table.clear();
        });
        size = { bytes: 0, length: 0 };
      });
    },
    initializeTrackCache() {
      return enqueue(async () => {
        const next = await db.transaction('rw', db.trackSources, async () => {
          const total = await scan();
          await evict(total);
          return total;
        });
        size = next;
        return { ...size };
      });
    },
    async cacheTrackSource(track, url, bitRate, from = 'netease') {
      const source = await download(url);
      return enqueue(async () => {
        const next = await db.transaction('rw', db.trackSources, async () => {
          const total = { ...(size || (await scan())) };
          const old = await db.trackSources.get(Number(track.id));
          await db.trackSources.put({
            id: Number(track.id),
            source,
            bitRate,
            from,
            name: track.name,
            artist:
              track.ar?.[0]?.name || track.artists?.[0]?.name || 'Unknown',
            createTime: Date.now(),
          });
          total.bytes += source.byteLength - byteSize(old);
          if (!old) total.length++;
          await evict(total);
          return total;
        });
        size = next;
        return { trackID: track.id, source, bitRate };
      });
    },
    getTrackSource(id) {
      return enqueue(() =>
        db.trackSources.get(Number(id)).then(row => row || null)
      );
    },
    countDBSize() {
      return enqueue(async () => {
        if (!size) size = await scan();
        return { ...size };
      });
    },
  };
}
