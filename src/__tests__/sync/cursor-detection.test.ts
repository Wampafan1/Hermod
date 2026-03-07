import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ColumnSchema } from "@/lib/sync/types";

// Mock the LLM provider
const mockChat = vi.fn();
vi.mock("@/lib/llm", () => ({
  getLlmProvider: () => ({ chat: mockChat, name: "mock" }),
}));

// Import AFTER mock setup
const { detectCursorStrategy, inferPrimaryKey, buildDetectionPrompt } = await import(
  "@/lib/sync/cursor-detection"
);

describe("cursor-detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const NETSUITE_COLUMNS: ColumnSchema[] = [
    { name: "internalid", type: "NUMBER(10)", nullable: false, isPrimaryKey: true },
    { name: "entityid", type: "VARCHAR2(100)", nullable: true },
    { name: "companyname", type: "VARCHAR2(200)", nullable: true },
    { name: "lastmodifieddate", type: "TIMESTAMP", nullable: false },
    { name: "datecreated", type: "TIMESTAMP", nullable: true },
    { name: "isinactive", type: "VARCHAR2(1)", nullable: false },
  ];

  const SQLSERVER_COLUMNS: ColumnSchema[] = [
    { name: "Id", type: "int", nullable: false, isPrimaryKey: true },
    { name: "Name", type: "nvarchar(100)", nullable: true },
    { name: "UpdatedAt", type: "datetime2", nullable: false, isIndexed: true },
    { name: "RowVer", type: "rowversion", nullable: false },
  ];

  const LOG_COLUMNS: ColumnSchema[] = [
    { name: "log_id", type: "bigint", nullable: false, isPrimaryKey: true, isIndexed: true },
    { name: "event_type", type: "varchar(50)", nullable: false },
    { name: "created_at", type: "timestamp", nullable: false },
    { name: "payload", type: "jsonb", nullable: true },
  ];

  describe("detectCursorStrategy", () => {
    it("parses valid AI response into CursorConfig", async () => {
      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({
          strategy: "timestamp_cursor",
          cursorColumn: "lastmodifieddate",
          cursorColumnType: "TIMESTAMP",
          primaryKey: "internalid",
          confidence: "high",
          reasoning: "lastmodifieddate is a non-nullable timestamp updated on every modification.",
          warnings: ["Soft deletes will not be detected"],
          candidates: [
            { column: "lastmodifieddate", strategy: "timestamp_cursor", score: 95, reason: "Perfect cursor" },
            { column: "datecreated", strategy: "timestamp_cursor", score: 40, reason: "Only tracks creation" },
          ],
        }),
        usage: { inputTokens: 100, outputTokens: 200 },
        model: "test",
      });

      const result = await detectCursorStrategy({
        tableName: "customer",
        sourceSystem: "NetSuite",
        realm: "alfheim",
        columns: NETSUITE_COLUMNS,
      });

      expect(result.strategy).toBe("timestamp_cursor");
      expect(result.cursorColumn).toBe("lastmodifieddate");
      expect(result.primaryKey).toBe("internalid");
      expect(result.confidence).toBe("high");
      expect(result.candidates).toHaveLength(2);
      expect(result.warnings).toContain("Soft deletes will not be detected");
    });

    it("falls back to full_refresh on invalid JSON response", async () => {
      mockChat.mockResolvedValueOnce({
        content: "I cannot determine a strategy for this table",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      });

      const result = await detectCursorStrategy({
        tableName: "unknown_table",
        sourceSystem: "Generic",
        realm: "alfheim",
        columns: [{ name: "col1", type: "text", nullable: true }],
      });

      expect(result.strategy).toBe("full_refresh");
      expect(result.cursorColumn).toBeNull();
      expect(result.confidence).toBe("low");
    });

    it("falls back to full_refresh on missing required fields", async () => {
      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({ cursorColumn: "foo" }),
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      });

      const result = await detectCursorStrategy({
        tableName: "broken",
        sourceSystem: "Generic",
        realm: "alfheim",
        columns: [{ name: "foo", type: "text", nullable: true }],
      });

      expect(result.strategy).toBe("full_refresh");
      expect(result.confidence).toBe("low");
    });

    it("falls back to full_refresh on LLM error", async () => {
      mockChat.mockRejectedValueOnce(new Error("API rate limit"));

      const result = await detectCursorStrategy({
        tableName: "items",
        sourceSystem: "NetSuite",
        realm: "alfheim",
        columns: NETSUITE_COLUMNS,
      });

      expect(result.strategy).toBe("full_refresh");
      expect(result.confidence).toBe("low");
      expect(result.primaryKey).toBe("internalid");
    });

    it("sends correct system and user messages to LLM", async () => {
      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({
          strategy: "full_refresh",
          cursorColumn: null,
          cursorColumnType: null,
          primaryKey: null,
          confidence: "low",
          reasoning: "No cursor found",
          warnings: [],
          candidates: [],
        }),
        usage: { inputTokens: 100, outputTokens: 100 },
        model: "test",
      });

      await detectCursorStrategy({
        tableName: "audit_log",
        sourceSystem: "PostgreSQL",
        realm: "alfheim",
        columns: LOG_COLUMNS,
      });

      expect(mockChat).toHaveBeenCalledOnce();
      const req = mockChat.mock.calls[0][0];
      expect(req.messages).toHaveLength(2);
      expect(req.messages[0].role).toBe("system");
      expect(req.messages[0].content).toContain("timestamp_cursor");
      expect(req.messages[1].role).toBe("user");
      expect(req.messages[1].content).toContain("audit_log");
      expect(req.messages[1].content).toContain("PostgreSQL");
      expect(req.messages[1].content).toContain("log_id");
      expect(req.responseFormat).toEqual({ type: "json_object" });
    });
  });

  describe("inferPrimaryKey", () => {
    it("returns column marked as isPrimaryKey", () => {
      expect(inferPrimaryKey(NETSUITE_COLUMNS)).toBe("internalid");
    });

    it("falls back to known PK name patterns", () => {
      const cols: ColumnSchema[] = [
        { name: "entity_id", type: "int", nullable: false },
        { name: "name", type: "text", nullable: true },
      ];
      expect(inferPrimaryKey(cols)).toBe("entity_id");
    });

    it("returns null when no PK can be inferred", () => {
      const cols: ColumnSchema[] = [
        { name: "value", type: "text", nullable: true },
        { name: "description", type: "text", nullable: true },
      ];
      expect(inferPrimaryKey(cols)).toBeNull();
    });
  });

  describe("buildDetectionPrompt", () => {
    it("formats column list with flags", () => {
      const prompt = buildDetectionPrompt({
        tableName: "items",
        sourceSystem: "SQL Server",
        realm: "alfheim",
        columns: SQLSERVER_COLUMNS,
      });

      expect(prompt).toContain("Source system: SQL Server");
      expect(prompt).toContain("Table: items");
      expect(prompt).toContain("Id (int) [PRIMARY KEY, NOT NULL]");
      expect(prompt).toContain("UpdatedAt (datetime2) [INDEXED, NOT NULL]");
      expect(prompt).toContain("RowVer (rowversion) [NOT NULL]");
      expect(prompt).toContain("Name (nvarchar(100)) [NULLABLE]");
    });
  });
});
