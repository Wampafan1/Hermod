export function serializeConnection<T extends object>(connection: T): Omit<T, "credentials"> {
  const { credentials: _credentials, ...safe } = connection as T & { credentials?: unknown };
  return safe;
}
