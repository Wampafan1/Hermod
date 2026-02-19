"use client";

import { useState, useEffect, useCallback } from "react";
import { ConnectionForm } from "@/components/connections/connection-form";
import { ConnectionCard } from "@/components/connections/connection-card";
import { useToast } from "@/components/toast";

type DbType = "POSTGRES" | "MSSQL" | "MYSQL" | "BIGQUERY";

interface Connection {
  id: string;
  name: string;
  type: DbType;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
}

export default function ConnectionsPage() {
  const toast = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/connections");
      if (res.ok) {
        setConnections(await res.json());
      }
    } catch {
      toast.error("Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  function handleAdd() {
    setEditingConnection(null);
    setShowForm(true);
  }

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
      fetchConnections();
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
    fetchConnections();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Connections</h1>
          <p className="text-gray-400 mt-1">
            Manage your database connections.
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-500 transition-colors"
        >
          Add Connection
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-gray-900 border border-gray-800 rounded-lg p-5 animate-pulse h-28"
            />
          ))}
        </div>
      ) : connections.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500">No connections yet.</p>
          <button
            onClick={handleAdd}
            className="mt-3 text-blue-400 hover:text-blue-300 text-sm"
          >
            Add your first connection
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              connection={conn}
              onEdit={() => handleEdit(conn)}
              onDelete={() => handleDelete(conn.id)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <ConnectionForm
          onSaved={handleFormSaved}
          onClose={handleFormClose}
          initial={editingConnection ?? undefined}
        />
      )}
    </div>
  );
}
