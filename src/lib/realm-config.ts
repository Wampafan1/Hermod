export const REALM_ICONS: Record<string, { icon: string; color: string }> = {
  NETSUITE: { icon: "\u2726", color: "#ce93d8" },   // ✦
  REST_API: { icon: "\u2726", color: "#ce93d8" },   // ✦
  BIGQUERY: { icon: "\u26A1", color: "#d4af37" },   // ⚡
  POSTGRES: { icon: "\u26A1", color: "#d4af37" },   // ⚡
  MSSQL:    { icon: "\u26A1", color: "#d4af37" },   // ⚡
  MYSQL:    { icon: "\u26A1", color: "#d4af37" },   // ⚡
  SFTP:     { icon: "\u26A1", color: "#66bb6a" },   // ⚡
};

export const DAILY_GREETINGS: Record<number, { greeting: string; flavor: string }> = {
  0: { greeting: "The Sun's Day dawns", flavor: "A day of rest — let the scheduled runs carry the load" },
  1: { greeting: "The Moon watches over the realms", flavor: "A new week of data flows begins" },
  2: { greeting: "Tyr's Day — a day for courage", flavor: "Bold routes and new connections await" },
  3: { greeting: "Woden's Day — the All-Father surveys", flavor: "Wednesday is Odin's own — the throne room is yours" },
  4: { greeting: "Thor's Day thunders forth", flavor: "The hammer strikes — let the forge do its work" },
  5: { greeting: "Freya's Day brings fortune", flavor: "End the week strong — check your realm health" },
  6: { greeting: "Saturn's Day — time to reckon", flavor: "Review the week's sagas before the new cycle" },
};
