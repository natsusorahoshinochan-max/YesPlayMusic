// Private orchestration shared by the concrete metadata reads.
export default async function readMetadata({ readCache, fetchLatest }) {
  const cached = await readCache();
  if (cached == null) return fetchLatest();

  Promise.resolve()
    .then(fetchLatest)
    .catch(error => {
      console.debug('[metadata] background refresh failed', error);
    });
  return cached;
}
