/**
 * Supabase auth fails with a different shape when the Supabase host is
 * unreachable (DNS NXDOMAIN, dropped TLS, offline) than when the credentials are
 * wrong. Reporting the unreachable case as "400 bad request" or dumping a raw
 * "AuthRetryableFetchError" at the user sends them hunting for a bug that isn't
 * there — it is the network.
 */
export function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const cause =
    err instanceof Error && 'cause' in err && err.cause
      ? ` ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`
      : '';
  const haystack = message + cause;
  return /fetch failed|Failed to fetch|ERR_NAME_NOT_RESOLVED|NetworkError|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|socket hang up|load failed/i.test(
    haystack,
  );
}

/** One line to show the user when Supabase itself is unreachable. */
export const NETWORK_HINT =
  'Cannot reach Supabase (DNS or connection). This is the network, not the credentials — ' +
  'try a different connection (hotspot / VPN), or set DNS to 1.1.1.1 / 8.8.8.8.';
