"use client";

import { useRef, useCallback } from "react";
import Editor, { OnMount } from "@monaco-editor/react";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
}

export function SqlEditor({ value, onChange, onRun }: SqlEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Define custom Norse theme
      monaco.editor.defineTheme("hermod-void", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "keyword", foreground: "7eb8d4", fontStyle: "bold" },
          { token: "keyword.sql", foreground: "7eb8d4", fontStyle: "bold" },
          { token: "string", foreground: "22c55e" },
          { token: "string.sql", foreground: "22c55e" },
          { token: "number", foreground: "f0b84a" },
          { token: "comment", foreground: "6b7280", fontStyle: "italic" },
          { token: "operator", foreground: "d4c4a0" },
          { token: "predefined.sql", foreground: "c9933a" },
          { token: "identifier", foreground: "d4c4a0" },
        ],
        colors: {
          "editor.background": "#080c1a",
          "editor.foreground": "#d4c4a0",
          "editorCursor.foreground": "#c9933a",
          "editor.lineHighlightBackground": "#0a0f22",
          "editor.selectionBackground": "rgba(201,147,58,0.15)",
          "editor.inactiveSelectionBackground": "rgba(201,147,58,0.08)",
          "editorLineNumber.foreground": "rgba(212,196,160,0.35)",
          "editorLineNumber.activeForeground": "#c9933a",
          "editorGutter.background": "#080c1a",
          "editorWidget.background": "#080c1a",
          "editorWidget.border": "rgba(201,147,58,0.1)",
          "input.background": "#04060f",
          "input.border": "rgba(201,147,58,0.1)",
          "input.foreground": "#d4c4a0",
          "focusBorder": "#c9933a",
          "list.activeSelectionBackground": "rgba(201,147,58,0.15)",
          "list.hoverBackground": "rgba(201,147,58,0.06)",
        },
      });
      monaco.editor.setTheme("hermod-void");

      // Ctrl+Enter to run query
      editor.addAction({
        id: "run-query",
        label: "Run Query",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => onRun(),
      });
    },
    [onRun]
  );

  return (
    <div className="h-full border border-border overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border bg-surface-raised">
        <span className="label-norse">SQL Query</span>
      </div>
      <Editor
        height="calc(100% - 30px)"
        defaultLanguage="sql"
        theme="hermod-void"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "var(--font-inconsolata), monospace",
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          padding: { top: 12 },
          suggestOnTriggerCharacters: true,
          renderLineHighlight: "line",
          cursorBlinking: "smooth",
        }}
      />
    </div>
  );
}
