export interface BackupObjectMetadata {
  key: string;
  bytes: number;
  etag?: string;
  lastModified?: Date;
}

export interface BackupUploadMetadata {
  policyId: string;
  runId: string;
  type: string;
  sourceConnectionId: string;
  database?: string;
  createdAt: string;
  checksumSha256?: string;
}

export type StorageTestStatus = "passed" | "failed" | "warning";

export interface StorageTestCheck {
  name: string;
  status: StorageTestStatus;
  message?: string;
}

export interface StorageTestResult {
  ok: boolean;
  checks: StorageTestCheck[];
  error?: string;
}

export interface BackupStorageProviderClient {
  uploadFile(
    localPath: string,
    objectKey: string,
    metadata?: Record<string, string> | BackupUploadMetadata
  ): Promise<BackupObjectMetadata>;
  downloadFile(objectKey: string, localPath: string): Promise<{ bytes: number }>;
  list(prefix: string): Promise<BackupObjectMetadata[]>;
  delete(objectKey: string): Promise<void>;
  test(): Promise<StorageTestResult>;
}

export interface StorageTargetLike {
  provider: string;
  accessMode?: string | null;
  config: unknown;
  credentials: string | null;
}

export interface PlainStorageTargetLike {
  provider: string;
  accessMode: string;
  config: unknown;
  credentials?: Record<string, unknown> | null;
}
