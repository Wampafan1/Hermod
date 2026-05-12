"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import {
  ODIN_COMMANDS,
  filterOdinCommands,
  getNextOdinCommandIndex,
  getOdinCommandDialogA11y,
  shouldCloseOdinCommandPalette,
  shouldOpenOdinCommandPalette,
  type OdinCommand,
} from "@/lib/navigation/odin-command-palette";

function CommandHint() {
  return (
    <span className="hidden items-center gap-1 sm:inline-flex">
      <kbd className="border border-border-mid bg-surface px-1.5 py-0.5 font-inconsolata text-[9px] text-text-dim">
        Ctrl/Cmd
      </kbd>
      <kbd className="border border-border-mid bg-surface px-1.5 py-0.5 font-inconsolata text-[9px] text-text-dim">
        K
      </kbd>
    </span>
  );
}

function commandMeta(command: OdinCommand): string {
  return `${command.group} / ${command.href}`;
}

export function OdinCommandPalette() {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = useMemo(
    () => filterOdinCommands(ODIN_COMMANDS, query),
    [query]
  );

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const openPalette = useCallback(() => {
    setOpen(true);
  }, []);

  useFocusTrap(panelRef, open, closePalette);

  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (!shouldOpenOdinCommandPalette(event)) return;
      event.preventDefault();
      if (open) {
        closePalette();
      } else {
        openPalette();
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [closePalette, open, openPalette]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
  }, [open, query]);

  const activateCommand = useCallback((command: OdinCommand) => {
    closePalette();
    router.push(command.href);
  }, [closePalette, router]);

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => getNextOdinCommandIndex(current, 1, filteredCommands.length));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => getNextOdinCommandIndex(current, -1, filteredCommands.length));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const command = filteredCommands[selectedIndex];
      if (command) activateCommand(command);
      return;
    }

    if (shouldCloseOdinCommandPalette(event)) {
      event.preventDefault();
      closePalette();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        className="group inline-flex min-h-8 items-center gap-2 border border-border bg-surface px-3 py-1 font-inconsolata text-[10px] uppercase tracking-[0.14em] text-text-dim transition-colors hover:border-gold hover:bg-gold-dim hover:text-gold"
        aria-label="Open Odin command palette"
      >
        <span aria-hidden className="text-gold transition-colors group-hover:text-gold-bright">
          {"\u16A8"}
        </span>
        <span>Odin</span>
        <CommandHint />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-carbon/70 px-4 pt-20"
          onClick={closePalette}
        >
          <div
            ref={panelRef}
            {...getOdinCommandDialogA11y(titleId)}
            className="w-full max-w-2xl border border-border-mid bg-deep animate-fade-up"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="label-norse !mb-1 text-[9px] text-gold">Odin Command Palette</p>
                  <h2 id={titleId} className="heading-norse text-sm">
                    Navigate the realms
                  </h2>
                </div>
                <div className="font-inconsolata text-[10px] uppercase tracking-[0.14em] text-text-dim">
                  Esc closes
                </div>
              </div>
            </div>

            <div className="border-b border-border bg-surface p-3">
              <label htmlFor="odin-command-search" className="sr-only">
                Search commands
              </label>
              <input
                id="odin-command-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                aria-controls={listId}
                aria-activedescendant={filteredCommands[selectedIndex]?.id}
                className="input-norse font-inconsolata text-sm"
                placeholder="Search navigation and actions..."
              />
            </div>

            <div id={listId} role="listbox" aria-label="Odin commands" className="max-h-[26rem] overflow-y-auto p-2">
              {filteredCommands.length > 0 ? (
                filteredCommands.map((command, index) => {
                  const selected = index === selectedIndex;
                  return (
                    <button
                      key={command.id}
                      id={command.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => activateCommand(command)}
                      className={`flex w-full items-center gap-3 border px-3 py-3 text-left transition-colors ${
                        selected
                          ? "border-gold bg-gold-dim text-text"
                          : "border-transparent text-text-dim hover:border-border hover:bg-surface hover:text-text"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-8 w-8 items-center justify-center border font-inconsolata text-sm ${
                          selected
                            ? "border-gold text-gold-bright"
                            : "border-border text-gold"
                        }`}
                      >
                        {command.rune}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-inconsolata text-xs uppercase tracking-[0.12em]">
                          {command.label}
                        </span>
                        <span className="mt-1 block truncate font-inconsolata text-[10px] uppercase tracking-[0.12em] text-text-dim">
                          {commandMeta(command)}
                        </span>
                      </span>
                      <span className="hidden border border-border bg-surface px-2 py-1 font-inconsolata text-[9px] uppercase tracking-[0.12em] text-text-dim sm:inline-flex">
                        Enter
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="border border-border bg-surface p-6 text-center">
                  <p className="font-inconsolata text-xs uppercase tracking-[0.14em] text-text-dim">
                    No command found.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
