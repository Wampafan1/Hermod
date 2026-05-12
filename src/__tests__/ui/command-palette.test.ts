import { describe, expect, it } from "vitest";
import {
  ODIN_COMMANDS,
  buildOdinCommandRouteMap,
  filterOdinCommands,
  getNextOdinCommandIndex,
  getOdinCommandDialogA11y,
  shouldCloseOdinCommandPalette,
  shouldOpenOdinCommandPalette,
} from "@/lib/navigation/odin-command-palette";

describe("Odin command palette", () => {
  it("opens with Ctrl+K or Cmd+K keyboard shortcuts", () => {
    expect(shouldOpenOdinCommandPalette({ key: "k", ctrlKey: true })).toBe(true);
    expect(shouldOpenOdinCommandPalette({ key: "K", metaKey: true })).toBe(true);
    expect(shouldOpenOdinCommandPalette({ key: "k", altKey: true, ctrlKey: true })).toBe(false);
    expect(shouldOpenOdinCommandPalette({ key: "k", ctrlKey: true, defaultPrevented: true })).toBe(false);
  });

  it("filters commands by labels, aliases, and routes", () => {
    expect(filterOdinCommands(ODIN_COMMANDS, "nifl").map((command) => command.label)).toEqual([
      "Go to Backups / Niflheim",
      "Create Backup Policy",
    ]);
    expect(filterOdinCommands(ODIN_COMMANDS, "create route")[0]).toMatchObject({
      label: "Create Route",
      href: "/bifrost/new",
    });
    expect(filterOdinCommands(ODIN_COMMANDS, "/gates/new")[0]).toMatchObject({
      label: "Create Gate",
      href: "/gates/new",
    });
  });

  it("supports wrapping keyboard navigation", () => {
    expect(getNextOdinCommandIndex(0, 1, 3)).toBe(1);
    expect(getNextOdinCommandIndex(2, 1, 3)).toBe(0);
    expect(getNextOdinCommandIndex(0, -1, 3)).toBe(2);
    expect(getNextOdinCommandIndex(-1, 1, 3)).toBe(0);
    expect(getNextOdinCommandIndex(-1, -1, 3)).toBe(2);
    expect(getNextOdinCommandIndex(0, 1, 0)).toBe(-1);
  });

  it("closes on Escape", () => {
    expect(shouldCloseOdinCommandPalette({ key: "Escape" })).toBe(true);
    expect(shouldCloseOdinCommandPalette({ key: "Enter" })).toBe(false);
  });

  it("uses the expected command routes", () => {
    expect(buildOdinCommandRouteMap()).toMatchObject({
      "Go to Dashboard": "/dashboard",
      "Go to Gates": "/gates",
      "Go to Bifrost": "/bifrost",
      "Go to Mjolnir": "/mjolnir",
      "Go to Backups / Niflheim": "/backups",
      "Go to Connections": "/connections",
      "Go to History": "/history",
      "Create Gate": "/gates/new",
      "Create Report": "/reports/new",
      "Create Route": "/bifrost/new",
      "Create Backup Policy": "/backups/new",
    });
  });

  it("defines accessible dialog attributes for the focus-trapped palette", () => {
    expect(getOdinCommandDialogA11y("odin-title")).toEqual({
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "odin-title",
    });
  });
});
