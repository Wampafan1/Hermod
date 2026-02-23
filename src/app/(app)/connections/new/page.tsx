"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SourcePicker } from "@/components/connections/source-picker";
import { SftpWizard } from "@/components/connections/sftp-wizard";
import type { SourceType } from "@/components/connections/source-picker";

const SQL_TYPES = new Set<SourceType>(["POSTGRES", "MSSQL", "MYSQL", "BIGQUERY"]);
const EMAIL_TYPES = new Set<SourceType>(["EMAIL_SMTP"]);

const SOURCE_NAMES: Record<SourceType, string> = {
  POSTGRES: "PostgreSQL",
  MSSQL: "SQL Server",
  MYSQL: "MySQL",
  BIGQUERY: "BigQuery",
  ADP: "ADP",
  QUICKBOOKS: "QuickBooks",
  SAP: "SAP",
  GENERIC_FILE: "File Drop",
  CUSTOM_SFTP: "Custom SFTP",
  EMAIL_SMTP: "SMTP Email",
};

export default function NewConnectionPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<{
    type: SourceType;
    name: string;
  } | null>(null);

  function handleSelect(source: { type: SourceType; name: string }) {
    if (SQL_TYPES.has(source.type)) {
      router.push(`/connections?add=${source.type}`);
      return;
    }
    if (EMAIL_TYPES.has(source.type)) {
      router.push(`/connections?addEmail=SMTP`);
      return;
    }
    setSelected(source);
  }

  if (selected && !SQL_TYPES.has(selected.type) && !EMAIL_TYPES.has(selected.type)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="heading-norse text-xl">New {selected.name} Connection</h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">
            Set up SFTP file delivery from {selected.name}
          </p>
        </div>
        <SftpWizard
          sourceType={selected.type as Exclude<SourceType, "POSTGRES" | "MSSQL" | "MYSQL" | "BIGQUERY" | "EMAIL_SMTP">}
          sourceName={selected.name}
          onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-norse text-xl">New Connection</h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">
            Choose a data source to connect
          </p>
        </div>
        <button onClick={() => router.push("/connections")} className="btn-ghost">
          <span>Back to Connections</span>
        </button>
      </div>
      <SourcePicker onSelect={handleSelect} />
    </div>
  );
}
