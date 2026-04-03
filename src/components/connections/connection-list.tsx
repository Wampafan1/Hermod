"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConnectionForm } from "@/components/connections/connection-form";
import { ConnectionCard } from "@/components/connections/connection-card";
import type { UnifiedConnection } from "@/components/connections/connection-card";
import { EmailConnectionCard } from "@/components/connections/email-connection-card";
import { EmailConnectionForm } from "@/components/connections/email-connection-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RuneDivider } from "@/components/rune-divider";
import { useToast } from "@/components/toast";

type AuthType = "NONE" | "PLAIN" | "OAUTH2";

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
  connections: UnifiedConnection[];
  emailConnections: EmailConnection[];
}

const SQL_TYPES = new Set(["POSTGRES", "MSSQL", "MYSQL"]);
const CLOUD_TYPES = new Set(["BIGQUERY", "NETSUITE"]);
const ALLOWED_ADD_TYPES = new Set(["POSTGRES", "MSSQL", "MYSQL", "BIGQUERY", "NETSUITE", "SFTP"]);

export function ConnectionList({
  connections: initialConnections,
  emailConnections: initialEmail,
}: ConnectionListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<UnifiedConnection | null>(null);

  // Email form state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [editingEmail, setEditingEmail] = useState<EmailConnection | null>(null);

  // Confirm dialog state
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; type: "connection" | "email" } | null>(null);

  // Handle ?add=TYPE query param from /connections/new SQL redirect
  useEffect(() => {
    const addType = searchParams.get("add");
    if (addType && ALLOWED_ADD_TYPES.has(addType)) {
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

  function handleEdit(conn: UnifiedConnection) {
    setEditingConnection(conn);
    setShowForm(true);
  }

  function handleDelete(id: string) {
    setConfirmTarget({ id, type: "connection" });
  }

  async function executeDelete() {
    if (!confirmTarget) return;
    const { id, type } = confirmTarget;
    setConfirmTarget(null);
    try {
      const url = type === "email" ? `/api/email-connections/${id}` : `/api/connections/${id}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Delete failed");
        return;
      }
      toast.success(type === "email" ? "Email connection deleted" : "Connection deleted");
      router.refresh();
    } catch {
      toast.error("Network error");
    }
  }

  function handleEditEmail(conn: EmailConnection) {
    setEditingEmail(conn);
    setShowEmailForm(true);
  }

  function handleDeleteEmail(id: string) {
    setConfirmTarget({ id, type: "email" });
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

  // Filter connections by category
  const sqlConnections = initialConnections.filter((c) => SQL_TYPES.has(c.type));
  const cloudConnections = initialConnections.filter((c) => CLOUD_TYPES.has(c.type));
  const sftpConnections = initialConnections.filter((c) => c.type === "SFTP");

  const hasAny = initialConnections.length > 0 || initialEmail.length > 0;

  return (
    <>
      {!hasAny ? (
        <div className="text-center py-16 bg-deep border border-border">
          <span className="text-4xl font-cinzel block mb-3 animate-rune-float" style={{ color: "rgba(206,147,216,0.3)" }}>ᚨ</span>
          <p className="text-text-dim text-sm tracking-wide">No bridges built yet.</p>
          <p className="text-text-muted text-xs tracking-wide mt-1">Connect to your first realm.</p>
          <Link href="/connections/new" className="btn-ghost mt-4 inline-block">
            Add Connection
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Database Connections (SQL) */}
          {sqlConnections.length > 0 && (
            <div>
              <h2 className="heading-norse text-sm mb-3" style={{ color: "#d4af37" }}>Database Connections</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px">
                {sqlConnections.map((conn) => (
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

          {/* Cloud & API Connections */}
          {cloudConnections.length > 0 && (
            <div>
              {sqlConnections.length > 0 && (
                <RuneDivider rune="ᚾ" color="#ce93d8" className="mb-4" />
              )}
              <h2 className="heading-norse text-sm mb-3" style={{ color: "#ce93d8" }}>Cloud & API</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px">
                {cloudConnections.map((conn) => (
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
          {sftpConnections.length > 0 && (
            <div>
              {(sqlConnections.length > 0 || cloudConnections.length > 0) && (
                <RuneDivider rune="ᚺ" color="#66bb6a" className="mb-4" />
              )}
              <h2 className="heading-norse text-sm mb-3" style={{ color: "#66bb6a" }}>File Integrations</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px">
                {sftpConnections.map((conn) => (
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

          {/* Email Connections */}
          {initialEmail.length > 0 && (
            <div>
              {initialConnections.length > 0 && (
                <RuneDivider rune="ᛖ" color="#66bb6a" className="mb-4" />
              )}
              <h2 className="heading-norse text-sm mb-3" style={{ color: "#66bb6a" }}>Email Delivery</h2>
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

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget?.type === "email" ? "Delete Email Connection" : "Delete Connection"}
        message={confirmTarget?.type === "email"
          ? "This email connection will be permanently removed. This cannot be undone."
          : "This connection will be permanently removed. Any reports using it will lose their data source."}
        onConfirm={executeDelete}
        onCancel={() => setConfirmTarget(null)}
      />
    </>
  );
}
