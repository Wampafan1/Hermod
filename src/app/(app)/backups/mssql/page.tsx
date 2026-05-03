import { MssqlBackupList } from "@/components/backups/mssql/mssql-backup-list";

export const dynamic = "force-dynamic";

export default function MssqlBackupsPage() {
  return <MssqlBackupList />;
}
