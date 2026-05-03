import { vi } from "vitest";

function modelMock() {
  return {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  };
}

export function createMockPrisma() {
  return {
    user: modelMock(),
    tenant: modelMock(),
    tenantMembership: modelMock(),
    connection: modelMock(),
    bifrostRoute: modelMock(),
    routeLog: modelMock(),
    backupStorageTarget: modelMock(),
    postgresBackupPolicy: modelMock(),
    postgresBackupRun: modelMock(),
    postgresRestoreJob: modelMock(),
    mssqlBackupPolicy: modelMock(),
    mssqlBackupRun: modelMock(),
    report: modelMock(),
    schedule: modelMock(),
    ravenSatellite: modelMock(),
    blueprint: modelMock(),
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  };
}

export type MockPrisma = ReturnType<typeof createMockPrisma>;
