
/**
 * Coerces an unknown error into a proper Error object.
 */
export const toError = (e: unknown): Error => {
  if (e instanceof Error) return e;
  if (typeof e === 'string') return new Error(e);
  if (e && typeof e === 'object' && 'message' in e && typeof (e as any).message === 'string') {
    return new Error((e as any).message);
  }
  try {
    return new Error(`Unknown error: ${JSON.stringify(e)}`);
  } catch {
    return new Error(`Unknown error: ${String(e)}`);
  }
};
