"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConnectionForm } from "@/components/connections/connection-form";
import { ConnectionCard } from "@/components/connections/connection-card";
import type { UnifiedConnection } from "@/components/connections/connection-card";
import { EmailConnectionCard } from "@/components/connections/email-connection-card";
import { EmailConnectionForm } from "@/components/connections/email-connection-form";
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

  // Filter connections by category
  const sqlConnections = initialConnections.filter((c) => SQL_TYPES.has(c.type));
  const cloudConnections = initialConnections.filter((c) => CLOUD_TYPES.has(c.type));
  const sftpConnections = initialConnections.filter((c) => c.type === "SFTP");

  const hasAny = initialConnections.length > 0 || initialEmail.length > 0;

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
          {/* Database Connections (SQL) */}
          {sqlConnections.length > 0 && (
            <div>
              <h2 className="heading-norse text-sm mb-3">Database Connections</h2>
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
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-gold/30 text-sm font-cinzel">ᚾ</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <h2 className="heading-norse text-sm mb-3">Cloud & API</h2>
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
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-gold/30 text-sm font-cinzel">ᚺ</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <h2 className="heading-norse text-sm mb-3">File Integrations</h2>
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
    </>
  );
}
