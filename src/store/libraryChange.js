import { RequestFailure } from '@/utils/request';

export const accountRequired = { status: 'denied', reason: 'account-required' };

export function changeResult(outcome, synchronization = 'not-required') {
  return { outcome, synchronization };
}

export async function performLibraryWrite(request) {
  let response;
  try {
    response = await request();
  } catch (error) {
    if (!(error instanceof RequestFailure)) throw error;
    return {
      status: error.category === 'network' ? 'unconfirmed' : 'rejected',
      ...(error.category !== 'network' && error.message
        ? { message: error.message }
        : {}),
    };
  }
  const body = response?.body?.code !== undefined ? response.body : response;
  if (body?.code === 200) return { status: 'succeeded' };
  const message = body?.message || body?.msg;
  throw new TypeError(message || 'Invalid library write response');
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
