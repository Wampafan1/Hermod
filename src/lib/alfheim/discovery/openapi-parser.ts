// ---------------------------------------------------------------------------
// Alfheim Discovery — OpenAPI / Swagger 2.0 spec parser
// ---------------------------------------------------------------------------

import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPI, OpenAPIV3, OpenAPIV2 } from "openapi-types";
import type { SchemaMapping, ColumnMapping, ChildTableMapping } from "../types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedEndpoint {
  path: string;
  method: string;
  summary: string;
  responseSchema: SchemaMapping;
  parameters: { name: string; in: string; required: boolean }[];
  suggestedName: string;
  responseRoot: string;
}

export interface ParsedSpec {
  title: string;
  version: string;
  baseUrl: string;
  auth: { type: string; config: Record<string, unknown> };
  endpoints: ParsedEndpoint[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function parseOpenApiSpec(input: {
  specUrl?: string;
  specContent?: string;
}): Promise<ParsedSpec> {
  if (!input.specUrl && !input.specContent) {
    throw new Error("Either specUrl or specContent is required");
  }

  // Parse and resolve $refs
  let api: OpenAPI.Document;
  if (input.specUrl) {
    api = await SwaggerParser.validate(input.specUrl);
  } else {
    const raw =
      typeof input.specContent === "string"
        ? JSON.parse(input.specContent)
        : input.specContent;
    api = await SwaggerParser.validate(raw as OpenAPI.Document);
  }

  const isOAS3 = "openapi" in api;
  const title = api.info?.title ?? "Untitled API";
  const version = api.info?.version ?? "0.0.0";
  const baseUrl = extractBaseUrl(api, isOAS3);
  const auth = extractAuth(api, isOAS3);
  const endpoints = extractEndpoints(api, isOAS3);

  return { title, version, baseUrl, auth, endpoints };
}

// ---------------------------------------------------------------------------
// Base URL extraction
// ---------------------------------------------------------------------------

function extractBaseUrl(api: OpenAPI.Document, isOAS3: boolean): string {
  if (isOAS3) {
    const oas3 = api as OpenAPIV3.Document;
    if (oas3.servers && oas3.servers.length > 0) {
      return oas3.servers[0].url;
    }
    return "";
  }

  // Swagger 2.0
  const sw2 = api as OpenAPIV2.Document;
  const scheme = sw2.schemes?.[0] ?? "https";
  const host = sw2.host ?? "";
  const basePath = sw2.basePath ?? "";
  if (!host) return basePath || "";
  return `${scheme}://${host}${basePath}`;
}

// ---------------------------------------------------------------------------
// Auth extraction
// ---------------------------------------------------------------------------

function extractAuth(
  api: OpenAPI.Document,
  isOAS3: boolean,
): { type: string; config: Record<string, unknown> } {
  if (isOAS3) {
    const oas3 = api as OpenAPIV3.Document;
    const schemes = oas3.components?.securitySchemes ?? {};
    for (const [name, schemeOrRef] of Object.entries(schemes)) {
      // After validate(), $refs should be resolved but guard anyway
      const scheme = schemeOrRef as OpenAPIV3.SecuritySchemeObject;
      if (scheme.type === "http" && scheme.scheme === "bearer") {
        return { type: "BEARER", config: { schemeName: name } };
      }
      if (scheme.type === "apiKey") {
        return {
          type: "API_KEY",
          config: {
            schemeName: name,
            headerName: scheme.name,
            in: scheme.in,
          },
        };
      }
      if (scheme.type === "http" && scheme.scheme === "basic") {
        return { type: "BASIC", config: { schemeName: name } };
      }
      if (scheme.type === "oauth2") {
        return { type: "OAUTH2", config: { schemeName: name, flows: scheme.flows } };
      }
    }
  } else {
    const sw2 = api as OpenAPIV2.Document;
    const defs = sw2.securityDefinitions ?? {};
    for (const [name, rawDef] of Object.entries(defs)) {
      const def = rawDef as OpenAPIV2.SecuritySchemeObject;
      if (def.type === "apiKey") {
        return {
          type: "API_KEY",
          config: { schemeName: name, headerName: def.name, in: def.in },
        };
      }
      if (def.type === "basic") {
        return { type: "BASIC", config: { schemeName: name } };
      }
      if (def.type === "oauth2") {
        return { type: "OAUTH2", config: { schemeName: name } };
      }
    }
  }

  return { type: "NONE", config: {} };
}

// ---------------------------------------------------------------------------
// Endpoint extraction
// ---------------------------------------------------------------------------

function extractEndpoints(
  api: OpenAPI.Document,
  isOAS3: boolean,
): ParsedEndpoint[] {
  const endpoints: ParsedEndpoint[] = [];
  const paths = api.paths ?? {};

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;
    const item = pathItem as Record<string, unknown>;

    // Only look at GET operations
    const getOp = item["get"] as
      | OpenAPIV3.OperationObject
      | OpenAPIV2.OperationObject
      | undefined;
    if (!getOp) continue;

    const responseSchema = extractResponseSchema(getOp, isOAS3);
    if (!responseSchema) continue;

    const parameters = extractParameters(getOp, pathItem as Record<string, unknown>);
    const suggestedName = suggestNameFromPath(path);

    endpoints.push({
      path,
      method: "GET",
      summary: getOp.summary ?? "",
      responseSchema: responseSchema.schema,
      parameters,
      suggestedName,
      responseRoot: responseSchema.root,
    });
  }

  return endpoints;
}

// ---------------------------------------------------------------------------
// Response schema extraction
// ---------------------------------------------------------------------------

function extractResponseSchema(
  operation: OpenAPIV3.OperationObject | OpenAPIV2.OperationObject,
  isOAS3: boolean,
): { schema: SchemaMapping; root: string } | null {
  if (isOAS3) {
    const oas3Op = operation as OpenAPIV3.OperationObject;
    const resp200 = oas3Op.responses?.["200"] as OpenAPIV3.ResponseObject | undefined;
    if (!resp200?.content) return null;

    const jsonContent =
      resp200.content["application/json"] ?? resp200.content["*/*"];
    if (!jsonContent?.schema) return null;

    return resolveArraySchema(jsonContent.schema as OpenAPIV3.SchemaObject);
  }

  // Swagger 2.0
  const sw2Op = operation as OpenAPIV2.OperationObject;
  const resp200 = sw2Op.responses?.["200"] as OpenAPIV2.ResponseObject | undefined;
  if (!resp200?.schema) return null;

  return resolveArraySchema(resp200.schema as OpenAPIV3.SchemaObject);
}

/**
 * Given a response schema, find where the data array lives and convert
 * the item schema into a `SchemaMapping`.
 *
 * Handles:
 *  - Direct array: `{ type: "array", items: { ... } }`
 *  - Wrapped: `{ type: "object", properties: { data: { type: "array", items: { ... } } } }`
 */
function resolveArraySchema(
  schema: OpenAPIV3.SchemaObject,
): { schema: SchemaMapping; root: string } | null {
  // Direct array
  if (schema.type === "array" && schema.items) {
    const itemSchema = schema.items as OpenAPIV3.SchemaObject;
    return { schema: oasSchemaToMapping(itemSchema), root: "$" };
  }

  // Object wrapper — look for the first property that is an array of objects
  if (schema.type === "object" && schema.properties) {
    // Prioritize common wrapper names
    const priority = ["data", "results", "items", "records", "entries", "rows"];
    const props = Object.entries(schema.properties);

    // Sort so priority keys come first
    props.sort(([a], [b]) => {
      const ai = priority.indexOf(a);
      const bi = priority.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return 0;
    });

    for (const [key, propSchema] of props) {
      const prop = propSchema as OpenAPIV3.SchemaObject;
      if (prop.type === "array" && prop.items) {
        const itemSchema = prop.items as OpenAPIV3.SchemaObject;
        return { schema: oasSchemaToMapping(itemSchema), root: key };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// OAS schema → SchemaMapping conversion
// ---------------------------------------------------------------------------

function oasSchemaToMapping(
  schema: OpenAPIV3.SchemaObject,
  prefix = "",
): SchemaMapping {
  const columns: ColumnMapping[] = [];
  const childTables: ChildTableMapping[] = [];

  if (!schema.properties) return { columns };

  for (const [key, propRef] of Object.entries(schema.properties)) {
    const prop = propRef as OpenAPIV3.SchemaObject;
    const jsonPath = prefix ? `${prefix}.${key}` : key;
    const columnName = jsonPath.replace(/\./g, "_").toLowerCase();
    const required = schema.required?.includes(key) ?? false;

    if (prop.type === "array" && prop.items) {
      const itemSchema = prop.items as OpenAPIV3.SchemaObject;
      // Array of objects → child table
      if (
        itemSchema.type === "object" ||
        (itemSchema.properties && Object.keys(itemSchema.properties).length > 0)
      ) {
        const childSchema = oasSchemaToMapping(itemSchema);
        childTables.push({
          jsonPath: key,
          tableName: key,
          foreignKey: "parent_id",
          columns: childSchema.columns,
        });
      } else {
        // Array of primitives → JSON column
        columns.push({
          jsonPath,
          columnName,
          dataType: "JSON",
          nullable: !required,
        });
      }
      continue;
    }

    if (
      prop.type === "object" &&
      prop.properties &&
      Object.keys(prop.properties).length > 0
    ) {
      // Flatten nested objects
      const nested = oasSchemaToMapping(prop, jsonPath);
      columns.push(...nested.columns);
      if (nested.childTables) childTables.push(...nested.childTables);
      continue;
    }

    columns.push({
      jsonPath,
      columnName,
      dataType: oasTypeToDataType(prop),
      nullable: !required,
    });
  }

  return {
    columns,
    ...(childTables.length > 0 ? { childTables } : {}),
  };
}

function oasTypeToDataType(
  prop: OpenAPIV3.SchemaObject,
): ColumnMapping["dataType"] {
  switch (prop.type) {
    case "integer":
      return "INTEGER";
    case "number":
      return "FLOAT";
    case "boolean":
      return "BOOLEAN";
    case "string":
      if (prop.format === "date-time" || prop.format === "date") return "TIMESTAMP";
      return "STRING";
    case "object":
      return "JSON";
    case "array":
      return "JSON";
    default:
      return "STRING";
  }
}

// ---------------------------------------------------------------------------
// Parameter extraction
// ---------------------------------------------------------------------------

function extractParameters(
  operation: OpenAPIV3.OperationObject | OpenAPIV2.OperationObject,
  pathItem: Record<string, unknown>,
): { name: string; in: string; required: boolean }[] {
  const params: { name: string; in: string; required: boolean }[] = [];
  const seen = new Set<string>();

  // Path-level params
  const pathParams = (pathItem["parameters"] ?? []) as Array<{
    name: string;
    in: string;
    required?: boolean;
  }>;
  for (const p of pathParams) {
    if (p.name && !seen.has(p.name)) {
      seen.add(p.name);
      params.push({ name: p.name, in: p.in, required: p.required ?? false });
    }
  }

  // Operation-level params (override path-level)
  const opParams = (operation.parameters ?? []) as Array<{
    name: string;
    in: string;
    required?: boolean;
  }>;
  for (const p of opParams) {
    if (p.name && !seen.has(p.name)) {
      seen.add(p.name);
      params.push({ name: p.name, in: p.in, required: p.required ?? false });
    }
  }

  return params;
}

// ---------------------------------------------------------------------------
// Name suggestion from path
// ---------------------------------------------------------------------------

function suggestNameFromPath(path: string): string {
  // Strip path params and version prefixes: /v2/orders/{id} → orders
  const segments = path
    .split("/")
    .filter((s) => s && !s.startsWith("{") && !/^v\d+$/i.test(s));

  const last = segments[segments.length - 1];
  if (!last) return "records";

  return last
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
