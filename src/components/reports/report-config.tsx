"use client";

interface Connection {
  id: string;
  name: string;
  type: string;
}

interface ReportConfigProps {
  name: string;
  description: string;
  connectionId: string;
  connections: Connection[];
  onNameChange: (name: string) => void;
  onDescriptionChange: (desc: string) => void;
  onConnectionChange: (id: string) => void;
  onSave: () => void;
  onSaveAndSchedule: () => void;
  saving: boolean;
  hasChanges: boolean;
  isNew: boolean;
}

export function ReportConfig({
  name,
  description,
  connectionId,
  connections,
  onNameChange,
  onDescriptionChange,
  onConnectionChange,
  onSave,
  onSaveAndSchedule,
  saving,
  hasChanges,
  isNew,
}: ReportConfigProps) {
  return (
    <div className="space-y-4 p-4 bg-gray-900 border border-gray-800 rounded-lg">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
        Report Config
      </h3>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder="Monthly Sales Report"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">
          Description (optional)
        </label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
          rows={3}
          placeholder="What does this report show?"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Connection</label>
        <select
          value={connectionId}
          onChange={(e) => onConnectionChange(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">Select a connection...</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <button
          onClick={onSave}
          disabled={saving || !name || !connectionId}
          className="w-full px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Report"}
        </button>
        {!isNew && (
          <button
            onClick={onSaveAndSchedule}
            disabled={saving || !name || !connectionId}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50"
          >
            Save & Schedule
          </button>
        )}
      </div>

      {hasChanges && (
        <p className="text-xs text-yellow-400">You have unsaved changes</p>
      )}
    </div>
  );
}
