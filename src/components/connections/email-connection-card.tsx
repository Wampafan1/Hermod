"use client";

type AuthType = "NONE" | "PLAIN" | "OAUTH2";

interface EmailConnectionCardProps {
  connection: {
    id: string;
    name: string;
    host: string;
    port: number;
    authType: AuthType;
    fromAddress: string;
  };
  onEdit: () => void;
  onDelete: () => void;
}

const AUTH_LABELS: Record<AuthType, string> = {
  NONE: "No Auth",
  PLAIN: "Password",
  OAUTH2: "OAuth2",
};

export function EmailConnectionCard({ connection, onEdit, onDelete }: EmailConnectionCardProps) {
  return (
    <div className="card-norse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h3 className="text-text text-sm">{connection.name}</h3>
          <span className="badge-neutral">
            {AUTH_LABELS[connection.authType]}
          </span>
          <p className="text-xs text-text-dim tracking-wide">
            {connection.host}:{connection.port}
          </p>
          <p className="text-xs text-text-dim tracking-wide">
            {connection.fromAddress}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onEdit} className="btn-subtle">
            Edit
          </button>
          <button onClick={onDelete} className="btn-subtle text-error hover:text-error">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
