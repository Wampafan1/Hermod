export type OdinCommandKind = "navigation" | "create";

export interface OdinCommand {
  id: string;
  label: string;
  href: string;
  group: string;
  kind: OdinCommandKind;
  rune: string;
  keywords: string[];
}

export interface KeyboardShortcutLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
}

export const ODIN_COMMANDS: OdinCommand[] = [
  {
    id: "go-dashboard",
    label: "Go to Dashboard",
    href: "/dashboard",
    group: "Navigation",
    kind: "navigation",
    rune: "\u16DF",
    keywords: ["home", "overview", "realm"],
  },
  {
    id: "go-gates",
    label: "Go to Gates",
    href: "/gates",
    group: "Navigation",
    kind: "navigation",
    rune: "\u16B7",
    keywords: ["realmgate", "realm gate", "uploads", "files"],
  },
  {
    id: "go-bifrost",
    label: "Go to Bifrost",
    href: "/bifrost",
    group: "Navigation",
    kind: "navigation",
    rune: "\u16D2",
    keywords: ["routes", "sync", "pipeline"],
  },
  {
    id: "go-mjolnir",
    label: "Go to Mjolnir",
    href: "/mjolnir",
    group: "Navigation",
    kind: "navigation",
    rune: "\u16D7",
    keywords: ["forge", "blueprints", "versions"],
  },
  {
    id: "go-backups",
    label: "Go to Backups / Niflheim",
    href: "/backups",
    group: "Navigation",
    kind: "navigation",
    rune: "\u16BE",
    keywords: ["niflheim", "backup", "pitr", "wal"],
  },
  {
    id: "go-connections",
    label: "Go to Connections",
    href: "/connections",
    group: "Navigation",
    kind: "navigation",
    rune: "\u16A8",
    keywords: ["sources", "databases", "credentials"],
  },
  {
    id: "go-history",
    label: "Go to History",
    href: "/history",
    group: "Navigation",
    kind: "navigation",
    rune: "\u16BA",
    keywords: ["runs", "chronicle", "logs"],
  },
  {
    id: "create-gate",
    label: "Create Gate",
    href: "/gates/new",
    group: "Create",
    kind: "create",
    rune: "\u16B7",
    keywords: ["new gate", "upload", "realmgate"],
  },
  {
    id: "create-report",
    label: "Create Report",
    href: "/reports/new",
    group: "Create",
    kind: "create",
    rune: "\u16A0",
    keywords: ["new report", "sql", "scroll"],
  },
  {
    id: "create-route",
    label: "Create Route",
    href: "/bifrost/new",
    group: "Create",
    kind: "create",
    rune: "\u16D2",
    keywords: ["new route", "sync", "bifrost"],
  },
  {
    id: "create-backup-policy",
    label: "Create Backup Policy",
    href: "/backups/new",
    group: "Create",
    kind: "create",
    rune: "\u16BE",
    keywords: ["new backup", "niflheim", "policy"],
  },
];

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function commandHaystack(command: OdinCommand): string {
  return normalizeSearch([
    command.label,
    command.group,
    command.href,
    command.kind,
    ...command.keywords,
  ].join(" "));
}

function commandScore(command: OdinCommand, query: string): number {
  const normalizedLabel = normalizeSearch(command.label);
  const haystack = commandHaystack(command);

  if (!query) return 0;
  if (normalizedLabel === query) return 100;
  if (normalizedLabel.startsWith(query)) return 90;
  if (normalizedLabel.includes(query)) return 75;
  if (haystack.includes(query)) return 50;

  const tokens = query.split(" ").filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) {
    return 40;
  }

  return -1;
}

export function filterOdinCommands(
  commands: OdinCommand[],
  query: string
): OdinCommand[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return commands;

  return commands
    .map((command, index) => ({
      command,
      index,
      score: commandScore(command, normalizedQuery),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.command);
}

export function getNextOdinCommandIndex(
  currentIndex: number,
  direction: 1 | -1,
  commandCount: number
): number {
  if (commandCount <= 0) return -1;
  if (currentIndex < 0) return direction === 1 ? 0 : commandCount - 1;
  return (currentIndex + direction + commandCount) % commandCount;
}

export function shouldOpenOdinCommandPalette(event: KeyboardShortcutLike): boolean {
  return !event.defaultPrevented &&
    !event.altKey &&
    !event.shiftKey &&
    (Boolean(event.ctrlKey) || Boolean(event.metaKey)) &&
    event.key.toLowerCase() === "k";
}

export function shouldCloseOdinCommandPalette(event: Pick<KeyboardShortcutLike, "key">): boolean {
  return event.key === "Escape";
}

export function buildOdinCommandRouteMap(commands: OdinCommand[] = ODIN_COMMANDS): Record<string, string> {
  return Object.fromEntries(commands.map((command) => [command.label, command.href]));
}

export function getOdinCommandDialogA11y(titleId: string): {
  role: "dialog";
  "aria-modal": "true";
  "aria-labelledby": string;
} {
  return {
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": titleId,
  };
}
