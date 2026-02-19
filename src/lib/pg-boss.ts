import PgBoss from "pg-boss";

const globalForBoss = globalThis as unknown as {
  pgBoss: PgBoss | undefined;
};

export function getBoss(): PgBoss {
  if (!globalForBoss.pgBoss) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set");
    }
    globalForBoss.pgBoss = new PgBoss({
      connectionString: databaseUrl,
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInHours: 24,
      archiveCompletedAfterSeconds: 86400, // 1 day
      deleteAfterDays: 7,
    });
  }
  return globalForBoss.pgBoss;
}
