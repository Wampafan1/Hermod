import { getBackupStorageProvider, getBackupStorageProviderFromPlain } from ".";
import type { PlainStorageTargetLike, StorageTargetLike, StorageTestResult } from "./types";

export async function testSavedStorageTarget(target: StorageTargetLike): Promise<StorageTestResult> {
  try {
    return await getBackupStorageProvider(target).test();
  } catch (error) {
    return {
      ok: false,
      checks: [
        {
          name: "Storage client",
          status: "failed",
          message: error instanceof Error ? error.message : "Could not initialize storage client",
        },
      ],
      error: error instanceof Error ? error.message : "Storage test failed",
    };
  }
}

export async function testUnsavedStorageTarget(target: PlainStorageTargetLike): Promise<StorageTestResult> {
  try {
    return await getBackupStorageProviderFromPlain(target).test();
  } catch (error) {
    return {
      ok: false,
      checks: [
        {
          name: "Storage client",
          status: "failed",
          message: error instanceof Error ? error.message : "Could not initialize storage client",
        },
      ],
      error: error instanceof Error ? error.message : "Storage test failed",
    };
  }
}
