export function serializeEmailConnection<T extends object>(connection: T): Omit<T, "password"> {
  const { password: _password, ...safe } = connection as T & { password?: unknown };
  return safe;
}

export function serializeSftpConnection<T extends object>(connection: T): Omit<T, "sftpPassword"> {
  const { sftpPassword: _sftpPassword, ...safe } = connection as T & { sftpPassword?: unknown };
  return safe;
}
