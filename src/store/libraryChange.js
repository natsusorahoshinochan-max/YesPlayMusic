export const accountRequired = { status: 'denied', reason: 'account-required' };

export function changeResult(outcome, synchronization = 'not-required') {
  return { outcome, synchronization };
}

export async function performLibraryWrite(request) {
  let response;
  try {
    response = await request();
  } catch (error) {
    if (
      !error?.isAxiosError &&
      ![
        'ECONNABORTED',
        'ETIMEDOUT',
        'ECONNRESET',
        'ENOTFOUND',
        'ERR_NETWORK',
      ].includes(error?.code)
    )
      throw error;
    return {
      status: 'unconfirmed',
      ...(error.message ? { message: error.message } : {}),
    };
  }
  const body = response?.body?.code !== undefined ? response.body : response;
  if (body?.code === 200) return { status: 'succeeded' };
  const message = body?.message || body?.msg;
  return {
    status: body?.code === undefined ? 'unconfirmed' : 'rejected',
    ...(message ? { message } : {}),
  };
}

export async function synchronize(attempts) {
  if (!attempts.length) return 'not-required';
  const results = await Promise.allSettled(
    attempts.map(attempt => Promise.resolve().then(attempt))
  );
  return results.every(result => result.status === 'fulfilled')
    ? 'completed'
    : 'incomplete';
}
