"use client";

export type SourceType =
  | "POSTGRES"
  | "MSSQL"
  | "MYSQL"
  | "BIGQUERY"
  | "ADP"
  | "QUICKBOOKS"
  | "SAP"
  | "GENERIC_FILE"
  | "CUSTOM_SFTP"
  | "EMAIL_SMTP";

interface SourceOption {
  type: SourceType;
  name: string;
  rune: string;
  description: string;
  category: "sql" | "sftp" | "email";
}

const SOURCES: SourceOption[] = [
  { type: "POSTGRES", name: "PostgreSQL", rune: "ᛈ", description: "Open-source relational database", category: "sql" },
  { type: "MSSQL", name: "SQL Server", rune: "ᛊ", description: "Microsoft SQL Server", category: "sql" },
  { type: "MYSQL", name: "MySQL", rune: "ᛗ", description: "Popular open-source database", category: "sql" },
  { type: "BIGQUERY", name: "BigQuery", rune: "ᚷ", description: "Google Cloud data warehouse", category: "sql" },
  { type: "ADP", name: "ADP", rune: "ᚨ", description: "Payroll and HR data via SFTP", category: "sftp" },
  { type: "QUICKBOOKS", name: "QuickBooks", rune: "ᚠ", description: "Accounting data via SFTP", category: "sftp" },
  { type: "SAP", name: "SAP", rune: "ᛉ", description: "ERP data via SFTP", category: "sftp" },
  { type: "GENERIC_FILE", name: "File Drop", rune: "ᚱ", description: "Receive any file via SFTP", category: "sftp" },
  { type: "CUSTOM_SFTP", name: "Custom SFTP", rune: "ᛏ", description: "Manual SFTP configuration", category: "sftp" },
  { type: "EMAIL_SMTP", name: "SMTP Email", rune: "ᛖ", description: "Configure SMTP for report delivery", category: "email" },
];

interface SourcePickerProps {
  onSelect: (source: SourceOption) => void;
}

export function SourcePicker({ onSelect }: SourcePickerProps) {
  const sqlSources = SOURCES.filter((s) => s.category === "sql");
  const sftpSources = SOURCES.filter((s) => s.category === "sftp");
  const emailSources = SOURCES.filter((s) => s.category === "email");

  return (
    <div className="space-y-8">
      <div>
        <h2 className="heading-norse text-sm mb-4">Database Connections</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
          {sqlSources.map((source) => (
            <SourceCard key={source.type} source={source} onClick={() => onSelect(source)} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-border" />
        <span className="text-gold/30 text-sm font-cinzel">ᚺ</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div>
        <h2 className="heading-norse text-sm mb-4">File Integrations</h2>
        <p className="text-text-dim text-xs tracking-wide mb-4">
          Receive files automatically from external systems via SFTP
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-px bg-border">
          {sftpSources.map((source) => (
            <SourceCard key={source.type} source={source} onClick={() => onSelect(source)} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-border" />
        <span className="text-gold/30 text-sm font-cinzel">ᛖ</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div>
        <h2 className="heading-norse text-sm mb-4">Email Delivery</h2>
        <p className="text-text-dim text-xs tracking-wide mb-4">
          Configure SMTP connections for sending reports
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
          {emailSources.map((source) => (
            <SourceCard key={source.type} source={source} onClick={() => onSelect(source)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SourceCard({
  source,
  onClick,
}: {
  source: SourceOption;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-deep p-5 text-left transition-all hover:bg-[rgba(201,147,58,0.04)] border border-transparent hover:border-gold-dim group cursor-pointer"
    >
      <span className="text-gold/40 text-2xl font-cinzel block mb-3 group-hover:text-gold/70 transition-colors">
        {source.rune}
      </span>
      <h3 className="text-text text-sm mb-1">{source.name}</h3>
      <p className="text-text-dim text-[0.625rem] tracking-wide leading-relaxed">
        {source.description}
      </p>
    </button>
  );
}
