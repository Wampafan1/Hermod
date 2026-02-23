"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConnectionForm } from "@/components/connections/connection-form";
import { ConnectionCard } from "@/components/connections/connection-card";
import { SftpConnectionCard } from "@/components/connections/sftp-connection-card";
import { CredentialCard } from "@/components/connections/credential-card";
import { EmailConnectionCard } from "@/components/connections/email-connection-card";
import { EmailConnectionForm } from "@/components/connections/email-connection-form";
import { useToast } from "@/components/toast";

type DbType = "POSTGRES" | "MSSQL" | "MYSQL" | "BIGQUERY";
type AuthType = "NONE" | "PLAIN" | "OAUTH2";

interface Connection {
  id: string;
  name: string;
  type: DbType;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
}

interface SftpConnection {
  id: string;
  name: string;
  sourceType: "ADP" | "QUICKBOOKS" | "SAP" | "GENERIC_FILE" | "CUSTOM_SFTP";
  status: "ACTIVE" | "ERROR" | "DISABLED";
  lastFileAt: string | null;
  lastFileName: string | null;
  filesProcessed: number;
  sftpUsername: string;
}

interface EmailConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  authType: AuthType;
  username?: string | null;
  fromAddress: string;
}

interface ConnectionListProps {
  connections: Connection[];
  sftpConnections: SftpConnection[];
  emailConnections: EmailConnection[];
}

export function ConnectionList({
  connections: initialConnections,
  sftpConnections: initialSftp,
  emailConnections: initialEmail,
}: ConnectionListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);

  // Email form state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [editingEmail, setEditingEmail] = useState<EmailConnection | null>(null);

  // Credential modal state
  const [viewingCredentials, setViewingCredentials] = useState<{
    host: string;
    port: number;
    username: string;
    password: string;
  } | null>(null);

  // Handle ?add=TYPE query param from /connections/new SQL redirect
  useEffect(() => {
    const addType = searchParams.get("add");
    if (addType && ["POSTGRES", "MSSQL", "MYSQL", "BIGQUERY"].includes(addType)) {
      setEditingConnection(null);
      setShowForm(true);
      router.replace("/connections", { scroll: false });
    }
  }, [searchParams, router]);

  // Handle ?addEmail=SMTP query param
  useEffect(() => {
    const addEmail = searchParams.get("addEmail");
    if (addEmail) {
      setEditingEmail(null);
      setShowEmailForm(true);
      router.replace("/connections", { scroll: false });
    }
  }, [searchParams, router]);

  function handleEdit(conn: Connection) {
    setEditingConnection(conn);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this connection?")) return;
    try {
      const res = await fetch(`/api/connections/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Delete failed");
        return;
      }
      toast.success("Connection deleted");
      router.refresh();
    } catch {
      toast.error("Network error");
    }
  }

  async function handleSftpDelete(id: string) {
    if (!confirm("Delete this SFTP connection? This will remove the SFTP user and all configuration.")) return;
    try {
      const res = await fetch(`/api/sftp-connections/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Delete failed");
        return;
      }
      toast.success("SFTP connection deleted");
      router.refresh();
    } catch {
      toast.error("Network error");
    }
  }

  async function handleViewCredentials(id: string) {
    try {
      const res = await fetch(`/api/sftp-connections/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to load credentials");
        return;
      }
      setViewingCredentials({
        host: data.sftpHost,
        port: data.sftpPort,
        username: data.sftpUsername,
        password: data.sftpPassword,
      });
    } catch {
      toast.error("Network error");
    }
  }

  function handleEditEmail(conn: EmailConnection) {
    setEditingEmail(conn);
    setShowEmailForm(true);
  }

  async function handleDeleteEmail(id: string) {
    if (!confirm("Delete this email connection?")) return;
    try {
      const res = await fetch(`/api/email-connections/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Delete failed");
        return;
      }
      toast.success("Email connection deleted");
      router.refresh();
    } catch {
      toast.error("Network error");
    }
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingConnection(null);
  }

  function handleFormSaved() {
    setShowForm(false);
    setEditingConnection(null);
    router.refresh();
  }

  function handleEmailFormClose() {
    setShowEmailForm(false);
    setEditingEmail(null);
  }

  function handleEmailFormSaved() {
    setShowEmailForm(false);
    setEditingEmail(null);
    router.refresh();
  }

  const hasAny = initialConnections.length > 0 || initialSftp.length > 0 || initialEmail.length > 0;

  return (
    <>
      {!hasAny ? (
        <div className="text-center py-16 bg-deep border border-border">
          <span className="text-gold/20 text-3xl font-cinzel block mb-3">ᚷ</span>
          <p className="text-text-dim text-xs tracking-wide">No connections yet.</p>
          <Link href="/connections/new" className="btn-subtle mt-3 inline-block">
            Add your first connection
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Database Connections */}
          {initialConnections.length > 0 && (
            <div>
              <h2 className="heading-norse text-sm mb-3">Database Connections</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px">
                {initialConnections.map((conn) => (
                  <ConnectionCard
                    key={conn.id}
                    connection={conn}
                    onEdit={() => handleEdit(conn)}
                    onDelete={() => handleDelete(conn.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* SFTP / File Connections */}
          {initialSftp.length > 0 && (
            <div>
              {initialConnections.length > 0 && (
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-gold/30 text-sm font-cinzel">ᚺ</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <h2 className="heading-norse text-sm mb-3">File Integrations</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px">
                {initialSftp.map((conn) => (
                  <SftpConnectionCard
                    key={conn.id}
                    connection={conn}
                    onViewCredentials={() => handleViewCredentials(conn.id)}
                    onDelete={() => handleSftpDelete(conn.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Email Connections */}
          {initialEmail.length > 0 && (
            <div>
              {(initialConnections.length > 0 || initialSftp.length > 0) && (
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-gold/30 text-sm font-cinzel">ᛖ</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <h2 className="heading-norse text-sm mb-3">Email Delivery</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px">
                {initialEmail.map((conn) => (
                  <EmailConnectionCard
                    key={conn.id}
                    connection={conn}
                    onEdit={() => handleEditEmail(conn)}
                    onDelete={() => handleDeleteEmail(conn.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <ConnectionForm
          onSaved={handleFormSaved}
          onClose={handleFormClose}
          initial={editingConnection ?? undefined}
        />
      )}

      {showEmailForm && (
        <EmailConnectionForm
          onSaved={handleEmailFormSaved}
          onClose={handleEmailFormClose}
          initial={editingEmail ?? undefined}
        />
      )}

      {/* Credential overlay */}
      {viewingCredentials && (
        <div
          className="fixed inset-0 bg-void/80 z-50 flex items-center justify-center p-6"
          onClick={() => setViewingCredentials(null)}
        >
          <div
            className="max-w-lg w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <CredentialCard
              credentials={[
                { label: "Host", value: viewingCredentials.host },
                { label: "Port", value: String(viewingCredentials.port) },
                { label: "Username", value: viewingCredentials.username },
                { label: "Password", value: viewingCredentials.password },
              ]}
            />
            <div className="flex justify-end">
              <button
                onClick={() => setViewingCredentials(null)}
                className="btn-ghost"
              >
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
