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

interface FolderInfo {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sortOrder: number;
  connectionCount: number;
}

interface ConnectionWithFolder extends UnifiedConnection {
  folderId: string | null;
}

interface ConnectionListProps {
  connections: ConnectionWithFolder[];
  emailConnections: EmailConnection[];
  folders: FolderInfo[];
  ravenCount: number;
}

const FILE_TYPES = new Set(["CSV_FILE", "EXCEL_FILE"]);

// ─── Folder Color Presets ───────────────────────────

const FOLDER_COLORS = [
  "#d4af37", // Asgard gold
  "#7eb8d4", // Frost blue
  "#66bb6a", // Midgard green
  "#ce93d8", // Alfheim purple
  "#a1887f", // Jotunheim brown
  "#ff8a65", // Muspelheim orange
  "#ef5350", // Helheim red
  "#4dd0e1", // Vanaheim teal
];

const AGENT_BANNER_KEY = "hermod:dismiss-agent-banner";

export function ConnectionList({
  connections: initialConnections,
  emailConnections: initialEmail,
  folders: initialFolders,
  ravenCount,
}: ConnectionListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const activeFolderId = searchParams.get("folderId");

  const [showForm, setShowForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<UnifiedConnection | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [editingEmail, setEditingEmail] = useState<EmailConnection | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; type: "connection" | "email" | "folder" } | null>(null);

  // Data Agent banner dismiss
  const [agentBannerDismissed, setAgentBannerDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(AGENT_BANNER_KEY) === "1";
  });

  function dismissAgentBanner() {
    localStorage.setItem(AGENT_BANNER_KEY, "1");
    setAgentBannerDismissed(true);
  }

  // Folder creation modal
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Move-to-folder dropdown
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  // Handle ?add=TYPE query param
  useEffect(() => {
    const addType = searchParams.get("add");
    const ALLOWED = new Set(["POSTGRES", "MSSQL", "MYSQL", "BIGQUERY", "NETSUITE", "SFTP"]);
    if (addType && ALLOWED.has(addType)) {
      setEditingConnection(null);
      setShowForm(true);
      router.replace("/connections", { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    const addEmail = searchParams.get("addEmail");
    if (addEmail) {
      setEditingEmail(null);
      setShowEmailForm(true);
      router.replace("/connections", { scroll: false });
    }
  }, [searchParams, router]);

  // ─── Folder Actions ─────────────────────────────────

  async function createFolder() {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const res = await fetch("/api/connection-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim(), color: newFolderColor }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        toast.error(data.error || "Failed to create folder");
        return;
      }
      toast.success("Folder created");
      setShowFolderModal(false);
      setNewFolderName("");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setCreatingFolder(false);
    }
  }

  async function deleteFolder(id: string) {
    try {
      const res = await fetch(`/api/connection-folders/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        toast.error(data.error || "Failed to delete folder");
        return;
      }
      toast.success("Folder deleted — connections moved to unfiled");
      if (activeFolderId === id) {
        router.replace("/connections", { scroll: false });
      }
      router.refresh();
    } catch {
      toast.error("Network error");
    }
  }

  async function moveConnection(connectionId: string, folderId: string | null) {
    try {
      const res = await fetch(`/api/connections/${connectionId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        toast.error(data.error || "Failed to move connection");
        return;
      }
      toast.success("Connection moved");
      setMoveTarget(null);
      router.refresh();
    } catch {
      toast.error("Network error");
    }
  }

  // ─── Connection Actions ─────────────────────────────

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
      const url =
        type === "email" ? `/api/email-connections/${id}` :
        type === "folder" ? `/api/connection-folders/${id}` :
        `/api/connections/${id}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Delete failed");
        return;
      }
      if (type === "folder") {
        toast.success("Folder deleted — connections moved to unfiled");
        if (activeFolderId === id) router.replace("/connections", { scroll: false });
      } else {
        toast.success(type === "email" ? "Email connection deleted" : "Connection deleted");
      }
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

  // ─── Filtering ──────────────────────────────────────

  const activeFolder = activeFolderId
    ? initialFolders.find((f) => f.id === activeFolderId)
    : null;

  const filteredConnections = activeFolderId
    ? initialConnections.filter((c) => c.folderId === activeFolderId)
    : null;

  const unfiledConnections = initialConnections.filter((c) => !c.folderId);

  // ─── Render: Folder Drill-In View ─────────────────

  if (activeFolder && filteredConnections) {
    return (
      <>
        {/* Back button + Breadcrumb */}
        <button
          onClick={() => router.replace("/connections", { scroll: false })}
          className="btn-subtle text-xs mb-3"
        >
          &larr; Back to Connections
        </button>
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => router.replace("/connections", { scroll: false })}
            className="text-text-dim text-xs font-inconsolata hover:text-gold transition-colors"
          >
            Connections
          </button>
          <span className="text-text-muted text-xs">/</span>
          <span className="text-text text-xs font-cinzel">{activeFolder.name}</span>
          <div className="flex-1" />
          <button
            onClick={() => setConfirmTarget({ id: activeFolder.id, type: "folder" })}
            className="btn-subtle text-[10px] text-ember"
          >
            Delete Folder
          </button>
        </div>

        {/* Folder accent bar */}
        <div className="h-0.5 mb-4" style={{ background: activeFolder.color }} />

        {filteredConnections.length === 0 ? (
          <div className="text-center py-12 bg-deep border border-border">
            <span className="text-3xl font-cinzel block mb-2 opacity-20" style={{ color: activeFolder.color }}>ᚨ</span>
            <p className="text-text-dim text-xs tracking-wide">No connections in this folder yet.</p>
            <p className="text-text-muted text-[10px] mt-1">Move connections here from the main view.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px">
            {filteredConnections.map((conn) => (
              <ConnectionCardWithActions
                key={conn.id}
                connection={conn}
                folders={initialFolders}
                moveTarget={moveTarget}
                setMoveTarget={setMoveTarget}
                onEdit={() => handleEdit(conn)}
                onDelete={() => handleDelete(conn.id)}
                onMove={moveConnection}
              />
            ))}
          </div>
        )}

        {showForm && (
          <ConnectionForm
            onSaved={() => { setShowForm(false); setEditingConnection(null); router.refresh(); }}
            onClose={() => { setShowForm(false); setEditingConnection(null); }}
            initial={editingConnection ?? undefined}
          />
        )}

        <ConfirmDialog
          open={!!confirmTarget}
          title={confirmTarget?.type === "folder" ? "Delete Folder" : "Delete Connection"}
          message={confirmTarget?.type === "folder"
            ? "This folder will be deleted. All connections inside will be moved to unfiled."
            : "This connection will be permanently removed."}
          onConfirm={executeDelete}
          onCancel={() => setConfirmTarget(null)}
        />
      </>
    );
  }

  // ─── Render: Top-Level View (Folders + Unfiled) ───

  const hasAny = initialConnections.length > 0 || initialEmail.length > 0 || initialFolders.length > 0;

  return (
    <>
      {/* Data Agent awareness banner */}
      {ravenCount === 0 && !agentBannerDismissed && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200/50 flex items-start gap-3">
          <span className="text-amber-700 text-lg leading-none mt-0.5 font-cinzel" aria-hidden="true">&#x16BA;</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-900 font-medium">
              Have on-premises databases?
              <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-mono font-bold tracking-wider uppercase align-middle">Thor</span>
            </p>
            <p className="text-xs text-amber-800/70 mt-0.5">
              The Hermod Data Agent bridges your local SQL Server, PostgreSQL, or MySQL to the cloud &mdash; no VPN needed.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/settings/ravens"
              className="text-xs font-inconsolata font-bold text-amber-800 hover:text-amber-950 tracking-wide transition-colors"
            >
              Set Up Data Agent &rarr;
            </Link>
            <button
              onClick={dismissAgentBanner}
              className="text-xs text-amber-600/60 hover:text-amber-800 transition-colors ml-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* New Folder button */}
      <div className="flex justify-end mb-2">
        <button onClick={() => setShowFolderModal(true)} className="btn-ghost text-xs">
          + New Folder
        </button>
      </div>

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
          {/* Folder Cards */}
          {initialFolders.length > 0 && (
            <div>
              <h2 className="heading-norse text-sm mb-3" style={{ color: "#d4af37" }}>Folders</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {initialFolders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => router.replace(`/connections?folderId=${folder.id}`, { scroll: false })}
                    className="bg-deep border border-border hover:border-gold-dim text-left p-4 transition-all group"
                  >
                    <div className="h-0.5 -mt-4 -mx-4 mb-3" style={{ background: folder.color }} />
                    <div className="flex items-center gap-2 mb-1">
                      {folder.icon && <span className="text-sm">{folder.icon}</span>}
                      <h3 className="font-cinzel text-sm text-text group-hover:text-gold-bright transition-colors">
                        {folder.name}
                      </h3>
                    </div>
                    <p className="text-[10px] font-inconsolata text-text-muted tracking-wider">
                      {folder.connectionCount} connection{folder.connectionCount !== 1 ? "s" : ""}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Unfiled Connections */}
          {unfiledConnections.length > 0 && (
            <div>
              {initialFolders.length > 0 && (
                <RuneDivider rune="ᚾ" color="#d4af37" className="mb-4" />
              )}
              <h2 className="heading-norse text-sm mb-3" style={{ color: "#d4af37" }}>Unfiled</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px">
                {unfiledConnections.map((conn) => (
                  <ConnectionCardWithActions
                    key={conn.id}
                    connection={conn}
                    folders={initialFolders}
                    moveTarget={moveTarget}
                    setMoveTarget={setMoveTarget}
                    onEdit={() => handleEdit(conn)}
                    onDelete={() => handleDelete(conn.id)}
                    onMove={moveConnection}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Email Connections */}
          {initialEmail.length > 0 && (
            <div>
              <RuneDivider rune="ᛖ" color="#66bb6a" className="mb-4" />
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

          {/* Data Agent card — permanent entry point */}
          <div>
            <RuneDivider rune="ᚺ" color="#d4af37" className="mb-4" />
            <h2 className="heading-norse text-sm mb-3" style={{ color: "#d4af37" }}>On-Premises</h2>
            <Link
              href="/settings/ravens"
              className="block bg-deep border border-amber-700/20 hover:border-gold-dim p-5 transition-all group"
            >
              <div className="flex items-start gap-4">
                <span className="text-2xl font-cinzel text-gold shrink-0 mt-0.5" aria-hidden="true">&#x16BA;</span>
                <div className="min-w-0">
                  <h3 className="font-cinzel text-sm text-text group-hover:text-gold-bright transition-colors">
                    On-Premises via Data Agent
                    <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-mono font-bold tracking-wider uppercase align-middle">Thor</span>
                  </h3>
                  <p className="text-[10px] font-inconsolata text-text-muted tracking-wider mt-1">
                    SQL Server &middot; PostgreSQL &middot; MySQL &mdash; through a local agent
                  </p>
                  {ravenCount > 0 && (
                    <p className="text-[10px] font-inconsolata text-gold tracking-wider mt-2">
                      {ravenCount} agent{ravenCount !== 1 ? "s" : ""} connected
                    </p>
                  )}
                </div>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <ConnectionForm
          onSaved={() => { setShowForm(false); setEditingConnection(null); router.refresh(); }}
          onClose={() => { setShowForm(false); setEditingConnection(null); }}
          initial={editingConnection ?? undefined}
        />
      )}
      {showEmailForm && (
        <EmailConnectionForm
          onSaved={() => { setShowEmailForm(false); setEditingEmail(null); router.refresh(); }}
          onClose={() => { setShowEmailForm(false); setEditingEmail(null); }}
          initial={editingEmail ?? undefined}
        />
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title={
          confirmTarget?.type === "email" ? "Delete Email Connection" :
          confirmTarget?.type === "folder" ? "Delete Folder" :
          "Delete Connection"
        }
        message={
          confirmTarget?.type === "email"
            ? "This email connection will be permanently removed."
            : confirmTarget?.type === "folder"
              ? "This folder will be deleted. Connections will be moved to unfiled."
              : "This connection will be permanently removed."
        }
        onConfirm={executeDelete}
        onCancel={() => setConfirmTarget(null)}
      />

      {/* New Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-deep border border-border p-6 w-full max-w-sm space-y-4">
            <h3 className="font-cinzel text-sm text-gold tracking-wider uppercase">New Folder</h3>

            <div>
              <label className="label-norse">Name</label>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="input-norse"
                placeholder="Client name, project, or job..."
                autoFocus
              />
            </div>

            <div>
              <label className="label-norse">Color</label>
              <div className="flex gap-2 mt-1">
                {FOLDER_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewFolderColor(color)}
                    className={`w-7 h-7 border-2 transition-all ${
                      newFolderColor === color ? "border-text scale-110" : "border-transparent"
                    }`}
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={createFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                className="btn-primary text-xs flex-1"
              >
                <span>{creatingFolder ? "Creating..." : "Create Folder"}</span>
              </button>
              <button
                onClick={() => { setShowFolderModal(false); setNewFolderName(""); }}
                className="btn-ghost text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Connection Card with Move Action ───────────────

function ConnectionCardWithActions({
  connection,
  folders,
  moveTarget,
  setMoveTarget,
  onEdit,
  onDelete,
  onMove,
}: {
  connection: ConnectionWithFolder;
  folders: FolderInfo[];
  moveTarget: string | null;
  setMoveTarget: (id: string | null) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (connectionId: string, folderId: string | null) => void;
}) {
  const isFileType = FILE_TYPES.has(connection.type);
  const showMoveMenu = moveTarget === connection.id;

  return (
    <div className="relative">
      <ConnectionCard
        connection={connection}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      {/* Action strip */}
      <div className="absolute top-2 right-2 flex gap-1">
        {isFileType && (
          <Link
            href={`/connections/${connection.id}/files`}
            className="btn-subtle text-[10px] text-frost"
          >
            Files
          </Link>
        )}
        <button
          onClick={() => setMoveTarget(showMoveMenu ? null : connection.id)}
          className="btn-subtle text-[10px]"
        >
          Move
        </button>
      </div>
      {/* Move dropdown */}
      {showMoveMenu && (
        <div className="absolute top-8 right-2 z-30 bg-deep border border-border shadow-lg min-w-[160px]">
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => onMove(connection.id, f.id)}
              className={`w-full text-left px-3 py-1.5 text-xs font-inconsolata hover:bg-scroll/30 flex items-center gap-2 ${
                connection.folderId === f.id ? "text-gold" : "text-text-dim"
              }`}
            >
              <span className="w-2 h-2" style={{ background: f.color }} />
              {f.name}
              {connection.folderId === f.id && <span className="ml-auto text-[9px]">current</span>}
            </button>
          ))}
          <button
            onClick={() => onMove(connection.id, null)}
            className={`w-full text-left px-3 py-1.5 text-xs font-inconsolata hover:bg-scroll/30 border-t border-border ${
              !connection.folderId ? "text-gold" : "text-text-dim"
            }`}
          >
            Unfiled
            {!connection.folderId && <span className="ml-2 text-[9px]">current</span>}
          </button>
        </div>
      )}
    </div>
  );
}
