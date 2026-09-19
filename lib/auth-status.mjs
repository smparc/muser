// These headers must come from Sites dispatch, never from request bodies or cookies.
// Email is display data; it must not become a fallback room ownership key.
export function identityStatus(headers) {
  const id = headers.get('oai-authenticated-user-id')?.trim();
  const email = headers.get('oai-authenticated-user-email')?.trim();
  if (id && email) return 'authenticated';
  if (id || email) return 'incomplete';
  return 'anonymous';
}
