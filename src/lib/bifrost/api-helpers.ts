export function serializeRouteLog<T extends { bytesTransferred?: bigint | number | null }>(
  log: T
): Omit<T, "bytesTransferred"> & { bytesTransferred?: string | null } {
  if (!Object.prototype.hasOwnProperty.call(log, "bytesTransferred")) {
    return log as Omit<T, "bytesTransferred"> & { bytesTransferred?: string | null };
  }

  const { bytesTransferred, ...rest } = log;
  return {
    ...rest,
    bytesTransferred: bytesTransferred == null ? null : bytesTransferred.toString(),
  };
}
