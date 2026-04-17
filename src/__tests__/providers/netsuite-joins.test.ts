import { describe, it, expect } from "vitest";
import {
  buildSuiteQL,
  getAvailableJoins,
  type NsJoin,
} from "@/lib/providers/netsuite.provider";

describe("buildSuiteQL — no joins (regression guard)", () => {
  it("produces unchanged output when joins array is absent", () => {
    const sql = buildSuiteQL({
      recordType: "customer",
      fields: ["id", "entityid", "email"],
    });
    expect(sql).toBe(
      "SELECT id, entityid, email FROM customer ORDER BY id ASC"
    );
  });

  it("produces unchanged output when joins array is empty", () => {
    const sql = buildSuiteQL({
      recordType: "customer",
      fields: ["id", "entityid"],
      joins: [],
    });
    expect(sql).toBe("SELECT id, entityid FROM customer ORDER BY id ASC");
  });
});

describe("buildSuiteQL — single join", () => {
  it("emits LEFT JOIN with aliased columns and qualified primary fields", () => {
    const joins: NsJoin[] = [
      {
        recordType: "transaction",
        alias: "tx",
        fields: ["trandate", "entity"],
      },
    ];
    const sql = buildSuiteQL({
      recordType: "transactionline",
      fields: ["id", "custcol_warehouse"],
      joins,
    });
    expect(sql).toBe(
      "SELECT transactionline.id, transactionline.custcol_warehouse, " +
        "tx.trandate AS tx_trandate, tx.entity AS tx_entity " +
        "FROM transactionline " +
        "LEFT JOIN transaction tx ON transactionline.transaction = tx.id " +
        "ORDER BY transactionline.id ASC"
    );
  });
});

describe("buildSuiteQL — two joins on same primary", () => {
  it("emits both joins in order without duplicate FROM", () => {
    const joins: NsJoin[] = [
      { recordType: "transaction", alias: "tx", fields: ["trandate"] },
      { recordType: "item", alias: "itemrec", fields: ["itemid"] },
    ];
    const sql = buildSuiteQL({
      recordType: "transactionline",
      fields: ["id"],
      joins,
    });
    expect(sql).toContain("LEFT JOIN transaction tx ON");
    expect(sql).toContain("LEFT JOIN item itemrec ON");
    expect(sql.match(/FROM /g)?.length).toBe(1);
    expect(sql).toContain("tx.trandate AS tx_trandate");
    expect(sql).toContain("itemrec.itemid AS itemrec_itemid");
  });
});

describe("buildSuiteQL — validation", () => {
  it("rejects a join pair absent from NS_JOIN_KEYS", () => {
    expect(() =>
      buildSuiteQL({
        recordType: "transactionline",
        fields: ["id"],
        joins: [{ recordType: "customer", alias: "cust", fields: ["id"] }],
      })
    ).toThrow(/Unsupported join/);
  });

  it("rejects an alias that doesn't match the curated definition", () => {
    expect(() =>
      buildSuiteQL({
        recordType: "transactionline",
        fields: ["id"],
        joins: [
          { recordType: "transaction", alias: "wrongalias", fields: ["trandate"] },
        ],
      })
    ).toThrow(/alias mismatch/i);
  });

  it("rejects SQL injection in a joined field name", () => {
    expect(() =>
      buildSuiteQL({
        recordType: "transactionline",
        fields: ["id"],
        joins: [
          {
            recordType: "transaction",
            alias: "tx",
            fields: ["trandate; DROP TABLE x"],
          },
        ],
      })
    ).toThrow(/Invalid field name/);
  });

  it("rejects SQL injection in a join record type", () => {
    expect(() =>
      buildSuiteQL({
        recordType: "transactionline",
        fields: ["id"],
        joins: [
          { recordType: "transaction; --", alias: "tx", fields: ["trandate"] },
        ],
      })
    ).toThrow();
  });
});

describe("getAvailableJoins", () => {
  it("returns curated joins for transactionline", () => {
    const joins = getAvailableJoins("transactionline");
    const records = joins.map((j) => j.recordType).sort();
    expect(records).toEqual(["item", "transaction"]);
  });

  it("returns customer and vendor for transaction", () => {
    const joins = getAvailableJoins("transaction");
    const records = joins.map((j) => j.recordType).sort();
    expect(records).toEqual(["customer", "vendor"]);
  });

  it("returns empty array for records without curated joins", () => {
    expect(getAvailableJoins("customer")).toEqual([]);
    expect(getAvailableJoins("vendor")).toEqual([]);
  });

  it("is case-insensitive on the primary record", () => {
    expect(getAvailableJoins("TRANSACTIONLINE").length).toBe(2);
  });

  it("surfaces the curated alias for each joined record", () => {
    const joins = getAvailableJoins("transactionline");
    const tx = joins.find((j) => j.recordType === "transaction");
    expect(tx?.alias).toBe("tx");
  });
});

describe("buildSuiteQL — filter passes through when referencing joined alias", () => {
  it("emits the filter verbatim after joins", () => {
    const sql = buildSuiteQL({
      recordType: "transactionline",
      fields: ["id"],
      joins: [{ recordType: "transaction", alias: "tx", fields: ["trandate"] }],
      filter: "tx.trandate >= '2026-01-01'",
    });
    expect(sql).toContain("WHERE tx.trandate >= '2026-01-01'");
    expect(sql.indexOf("LEFT JOIN")).toBeLessThan(sql.indexOf("WHERE"));
  });
});

describe("buildSuiteQL — ORDER BY with joins", () => {
  it("qualifies ORDER BY with primary table name when joins present", () => {
    const sql = buildSuiteQL({
      recordType: "transactionline",
      fields: ["id"],
      joins: [{ recordType: "transaction", alias: "tx", fields: ["trandate"] }],
    });
    expect(sql).toContain("ORDER BY transactionline.id ASC");
  });

  it("omits ORDER BY when 'id' not in primary fields", () => {
    const sql = buildSuiteQL({
      recordType: "transactionline",
      fields: ["custcol_warehouse"],
      joins: [{ recordType: "transaction", alias: "tx", fields: ["trandate"] }],
    });
    expect(sql).not.toContain("ORDER BY");
  });
});
