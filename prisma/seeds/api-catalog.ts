import { Prisma, PrismaClient } from "@prisma/client";

type JsonInput = Prisma.InputJsonValue;

// ---------------------------------------------------------------------------
// Alfheim API Catalog – 15 connectors, idempotent via upsert on slug
// ---------------------------------------------------------------------------

interface ColumnDef {
  jsonPath: string;
  columnName: string;
  dataType: "STRING" | "INTEGER" | "FLOAT" | "BOOLEAN" | "TIMESTAMP" | "DATE" | "JSON";
  nullable: boolean;
}

interface ChildTable {
  jsonPath: string;
  tableName: string;
  foreignKey: string;
  columns: ColumnDef[];
}

interface ObjectSchema {
  columns: ColumnDef[];
  childTables?: ChildTable[];
}

interface AuthField {
  key: string;
  label: string;
  type: "text" | "password";
  placeholder: string;
  required: boolean;
}

interface VariantDef {
  key: string;
  label: string;
  description: string;
  baseUrl: string;
  authType: "API_KEY" | "BEARER" | "BASIC" | "OAUTH2" | "CUSTOM";
  fields: AuthField[];
  headerName?: string;
  tokenPrefix?: string;
  pagination: PaginationConfig;
  objectPrefix: string;          // filters objects by slug prefix e.g. "v1-" or "v2-"
}

interface AuthConfig {
  fields: AuthField[];
  headerName?: string;
  tokenPrefix?: string;
  urlPlaceholders?: string[];
  variants?: VariantDef[];
  /** Inject credentials into POST body instead of headers (e.g. SkuVault). */
  bodyAuth?: boolean;
  /** Maps request body key → credential field name. */
  bodyTokenMap?: Record<string, string>;
}

interface PaginationConfig {
  type: "cursor" | "page_number" | "offset" | "link_header" | "none";
  pageParam?: string;
  limitParam?: string;
  defaultLimit?: number;
  cursorPath?: string;
  hasMorePath?: string;
  nextParam?: string;
  /** Use POST with JSON body instead of GET with query params (e.g. SkuVault). */
  requestMethod?: "GET" | "POST";
  /** Starting page index for page_number pagination (default 1). Set to 0 for 0-based APIs. */
  startPage?: number;
}

interface ObjectDef {
  slug: string;
  name: string;
  description: string;
  endpoint: string;
  method?: string;
  responseRoot: string;
  incrementalKey?: string;
  defaultParams?: Record<string, unknown>;
  schema: ObjectSchema;
}

interface ConnectorDef {
  slug: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  docsUrl: string;
  popularity: number;
  authType: "API_KEY" | "BEARER" | "BASIC" | "OAUTH2" | "CUSTOM";
  baseUrl: string;
  authConfig: AuthConfig;
  pagination: PaginationConfig;
  rateLimiting?: Record<string, unknown>;
  objects: ObjectDef[];
}

// ───────────────────────────────────────────────────────────────────────────
// 1. ShipStation
// ───────────────────────────────────────────────────────────────────────────
const shipStation: ConnectorDef = {
  slug: "shipstation",
  name: "ShipStation",
  description: "Shipping and order management platform — supports both Classic (v1) and v2 APIs",
  category: "Shipping",
  docsUrl: "https://docs.shipstation.com/",
  popularity: 85,
  authType: "BASIC",           // default (v1), overridden by variant selection
  baseUrl: "https://ssapi.shipstation.com",  // default (v1), overridden by variant selection
  authConfig: {
    fields: [],                // no top-level fields — variants supply them
    variants: [
      {
        key: "v1",
        label: "ShipStation Classic (v1)",
        description: "API Key + API Secret",
        baseUrl: "https://ssapi.shipstation.com",
        authType: "BASIC",
        fields: [
          { key: "username", label: "API Key", type: "password" as const, placeholder: "Your ShipStation API Key", required: true },
          { key: "password", label: "API Secret", type: "password" as const, placeholder: "Your ShipStation API Secret", required: true },
        ],
        pagination: { type: "page_number" as const, pageParam: "page", limitParam: "pageSize", defaultLimit: 100 },
        objectPrefix: "v1-",
      },
      {
        key: "v2",
        label: "ShipStation v2",
        description: "Single API Key",
        baseUrl: "https://api.shipstation.com",
        authType: "API_KEY",
        headerName: "api-key",
        fields: [
          { key: "apiKey", label: "API Key", type: "password" as const, placeholder: "Your ShipStation v2 API key", required: true },
        ],
        pagination: { type: "page_number" as const, pageParam: "page", limitParam: "page_size", defaultLimit: 25 },
        objectPrefix: "v2-",
      },
    ],
  },
  pagination: {
    type: "page_number",
    pageParam: "page",
    limitParam: "pageSize",
    defaultLimit: 100,
  },
  rateLimiting: { requestsPerWindow: 40, windowSeconds: 60 },
  objects: [
    // ── v1 objects ────────────────────────────────────────────────────────
    {
      slug: "v1-orders",
      name: "Orders",
      description: "Sales orders imported from channels or created manually",
      endpoint: "/orders",
      responseRoot: "orders",
      incrementalKey: "modifyDate",
      schema: {
        columns: [
          { jsonPath: "orderId", columnName: "order_id", dataType: "INTEGER", nullable: false },
          { jsonPath: "orderNumber", columnName: "order_number", dataType: "STRING", nullable: false },
          { jsonPath: "orderKey", columnName: "order_key", dataType: "STRING", nullable: true },
          { jsonPath: "orderDate", columnName: "order_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "createDate", columnName: "create_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "modifyDate", columnName: "modify_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "paymentDate", columnName: "payment_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "shipByDate", columnName: "ship_by_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "orderStatus", columnName: "order_status", dataType: "STRING", nullable: true },
          { jsonPath: "orderTotal", columnName: "order_total", dataType: "FLOAT", nullable: true },
          { jsonPath: "amountPaid", columnName: "amount_paid", dataType: "FLOAT", nullable: true },
          { jsonPath: "taxAmount", columnName: "tax_amount", dataType: "FLOAT", nullable: true },
          { jsonPath: "shippingAmount", columnName: "shipping_amount", dataType: "FLOAT", nullable: true },
          { jsonPath: "customerEmail", columnName: "customer_email", dataType: "STRING", nullable: true },
          { jsonPath: "shipTo.name", columnName: "ship_to_name", dataType: "STRING", nullable: true },
          { jsonPath: "shipTo.street1", columnName: "ship_to_street1", dataType: "STRING", nullable: true },
          { jsonPath: "shipTo.city", columnName: "ship_to_city", dataType: "STRING", nullable: true },
          { jsonPath: "shipTo.state", columnName: "ship_to_state", dataType: "STRING", nullable: true },
          { jsonPath: "shipTo.postalCode", columnName: "ship_to_postal_code", dataType: "STRING", nullable: true },
          { jsonPath: "shipTo.country", columnName: "ship_to_country", dataType: "STRING", nullable: true },
          { jsonPath: "requestedShippingService", columnName: "requested_shipping_service", dataType: "STRING", nullable: true },
          { jsonPath: "carrierCode", columnName: "carrier_code", dataType: "STRING", nullable: true },
          { jsonPath: "serviceCode", columnName: "service_code", dataType: "STRING", nullable: true },
          { jsonPath: "weight.value", columnName: "weight_value", dataType: "FLOAT", nullable: true },
          { jsonPath: "weight.units", columnName: "weight_units", dataType: "STRING", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "items",
            tableName: "orders_line_items",
            foreignKey: "order_id",
            columns: [
              { jsonPath: "orderItemId", columnName: "order_item_id", dataType: "INTEGER", nullable: false },
              { jsonPath: "lineItemKey", columnName: "line_item_key", dataType: "STRING", nullable: true },
              { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: true },
              { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
              { jsonPath: "quantity", columnName: "quantity", dataType: "INTEGER", nullable: true },
              { jsonPath: "unitPrice", columnName: "unit_price", dataType: "FLOAT", nullable: true },
              { jsonPath: "taxAmount", columnName: "tax_amount", dataType: "FLOAT", nullable: true },
              { jsonPath: "warehouseLocation", columnName: "warehouse_location", dataType: "STRING", nullable: true },
              { jsonPath: "productId", columnName: "product_id", dataType: "INTEGER", nullable: true },
              { jsonPath: "fulfillmentSku", columnName: "fulfillment_sku", dataType: "STRING", nullable: true },
            ],
          },
        ],
      },
    },
    {
      slug: "v1-shipments",
      name: "Shipments",
      description: "Fulfilled shipments with tracking information",
      endpoint: "/shipments",
      responseRoot: "shipments",
      incrementalKey: "createDate",
      schema: {
        columns: [
          { jsonPath: "shipmentId", columnName: "shipment_id", dataType: "INTEGER", nullable: false },
          { jsonPath: "orderId", columnName: "order_id", dataType: "INTEGER", nullable: true },
          { jsonPath: "orderNumber", columnName: "order_number", dataType: "STRING", nullable: true },
          { jsonPath: "createDate", columnName: "create_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "shipDate", columnName: "ship_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "shipmentCost", columnName: "shipment_cost", dataType: "FLOAT", nullable: true },
          { jsonPath: "insuranceCost", columnName: "insurance_cost", dataType: "FLOAT", nullable: true },
          { jsonPath: "trackingNumber", columnName: "tracking_number", dataType: "STRING", nullable: true },
          { jsonPath: "carrierCode", columnName: "carrier_code", dataType: "STRING", nullable: true },
          { jsonPath: "serviceCode", columnName: "service_code", dataType: "STRING", nullable: true },
          { jsonPath: "batchNumber", columnName: "batch_number", dataType: "STRING", nullable: true },
          { jsonPath: "voided", columnName: "voided", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "voidDate", columnName: "void_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "shipTo.name", columnName: "ship_to_name", dataType: "STRING", nullable: true },
          { jsonPath: "shipTo.city", columnName: "ship_to_city", dataType: "STRING", nullable: true },
          { jsonPath: "shipTo.state", columnName: "ship_to_state", dataType: "STRING", nullable: true },
          { jsonPath: "shipTo.postalCode", columnName: "ship_to_postal_code", dataType: "STRING", nullable: true },
          { jsonPath: "shipTo.country", columnName: "ship_to_country", dataType: "STRING", nullable: true },
          { jsonPath: "weight.value", columnName: "weight_value", dataType: "FLOAT", nullable: true },
          { jsonPath: "weight.units", columnName: "weight_units", dataType: "STRING", nullable: true },
        ],
      },
    },
    {
      slug: "v1-products",
      name: "Products",
      description: "Product catalog with SKU and inventory data",
      endpoint: "/products",
      responseRoot: "products",
      incrementalKey: "modifyDate",
      schema: {
        columns: [
          { jsonPath: "productId", columnName: "product_id", dataType: "INTEGER", nullable: false },
          { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: true },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "price", columnName: "price", dataType: "FLOAT", nullable: true },
          { jsonPath: "defaultCost", columnName: "default_cost", dataType: "FLOAT", nullable: true },
          { jsonPath: "length", columnName: "length", dataType: "FLOAT", nullable: true },
          { jsonPath: "width", columnName: "width", dataType: "FLOAT", nullable: true },
          { jsonPath: "height", columnName: "height", dataType: "FLOAT", nullable: true },
          { jsonPath: "weightOz", columnName: "weight_oz", dataType: "FLOAT", nullable: true },
          { jsonPath: "internalNotes", columnName: "internal_notes", dataType: "STRING", nullable: true },
          { jsonPath: "fulfillmentSku", columnName: "fulfillment_sku", dataType: "STRING", nullable: true },
          { jsonPath: "active", columnName: "active", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "createDate", columnName: "create_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "modifyDate", columnName: "modify_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "customsValue", columnName: "customs_value", dataType: "FLOAT", nullable: true },
          { jsonPath: "warehouseLocation", columnName: "warehouse_location", dataType: "STRING", nullable: true },
        ],
      },
    },
    {
      slug: "v1-warehouses",
      name: "Warehouses",
      description: "Warehouse and fulfillment center definitions",
      endpoint: "/warehouses",
      responseRoot: "$",
      schema: {
        columns: [
          { jsonPath: "warehouseId", columnName: "warehouse_id", dataType: "INTEGER", nullable: false },
          { jsonPath: "warehouseName", columnName: "warehouse_name", dataType: "STRING", nullable: true },
          { jsonPath: "originAddress.name", columnName: "origin_name", dataType: "STRING", nullable: true },
          { jsonPath: "originAddress.street1", columnName: "origin_street1", dataType: "STRING", nullable: true },
          { jsonPath: "originAddress.city", columnName: "origin_city", dataType: "STRING", nullable: true },
          { jsonPath: "originAddress.state", columnName: "origin_state", dataType: "STRING", nullable: true },
          { jsonPath: "originAddress.postalCode", columnName: "origin_postal_code", dataType: "STRING", nullable: true },
          { jsonPath: "originAddress.country", columnName: "origin_country", dataType: "STRING", nullable: true },
          { jsonPath: "originAddress.phone", columnName: "origin_phone", dataType: "STRING", nullable: true },
          { jsonPath: "isDefault", columnName: "is_default", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "createDate", columnName: "create_date", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
    // ── v2 objects ────────────────────────────────────────────────────────
    {
      slug: "v2-shipments",
      name: "Shipments",
      description: "Shipments with addresses, packages, carrier info, and line items",
      endpoint: "/v2/shipments",
      responseRoot: "shipments",
      incrementalKey: "modified_at",
      schema: {
        columns: [
          { jsonPath: "shipment_id", columnName: "shipment_id", dataType: "STRING", nullable: false },
          { jsonPath: "shipment_number", columnName: "shipment_number", dataType: "STRING", nullable: true },
          { jsonPath: "external_shipment_id", columnName: "external_shipment_id", dataType: "STRING", nullable: true },
          { jsonPath: "external_order_id", columnName: "external_order_id", dataType: "STRING", nullable: true },
          { jsonPath: "shipment_status", columnName: "shipment_status", dataType: "STRING", nullable: true },
          { jsonPath: "carrier_id", columnName: "carrier_id", dataType: "STRING", nullable: true },
          { jsonPath: "service_code", columnName: "service_code", dataType: "STRING", nullable: true },
          { jsonPath: "confirmation", columnName: "confirmation", dataType: "STRING", nullable: true },
          { jsonPath: "ship_date", columnName: "ship_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "ship_by_date", columnName: "ship_by_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "modified_at", columnName: "modified_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "warehouse_id", columnName: "warehouse_id", dataType: "STRING", nullable: true },
          { jsonPath: "store_id", columnName: "store_id", dataType: "STRING", nullable: true },
          { jsonPath: "is_return", columnName: "is_return", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "is_gift", columnName: "is_gift", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "zone", columnName: "zone", dataType: "INTEGER", nullable: true },
          { jsonPath: "ship_to.name", columnName: "ship_to_name", dataType: "STRING", nullable: true },
          { jsonPath: "ship_to.company_name", columnName: "ship_to_company", dataType: "STRING", nullable: true },
          { jsonPath: "ship_to.address_line1", columnName: "ship_to_address1", dataType: "STRING", nullable: true },
          { jsonPath: "ship_to.city_locality", columnName: "ship_to_city", dataType: "STRING", nullable: true },
          { jsonPath: "ship_to.state_province", columnName: "ship_to_state", dataType: "STRING", nullable: true },
          { jsonPath: "ship_to.postal_code", columnName: "ship_to_postal_code", dataType: "STRING", nullable: true },
          { jsonPath: "ship_to.country_code", columnName: "ship_to_country", dataType: "STRING", nullable: true },
          { jsonPath: "ship_to.phone", columnName: "ship_to_phone", dataType: "STRING", nullable: true },
          { jsonPath: "ship_from.name", columnName: "ship_from_name", dataType: "STRING", nullable: true },
          { jsonPath: "ship_from.city_locality", columnName: "ship_from_city", dataType: "STRING", nullable: true },
          { jsonPath: "ship_from.state_province", columnName: "ship_from_state", dataType: "STRING", nullable: true },
          { jsonPath: "ship_from.country_code", columnName: "ship_from_country", dataType: "STRING", nullable: true },
          { jsonPath: "total_weight.value", columnName: "total_weight_value", dataType: "FLOAT", nullable: true },
          { jsonPath: "total_weight.unit", columnName: "total_weight_unit", dataType: "STRING", nullable: true },
        ],
        childTables: [
          { jsonPath: "items", tableName: "shipments_items", foreignKey: "shipment_id", columns: [
            { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
            { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: true },
            { jsonPath: "quantity", columnName: "quantity", dataType: "INTEGER", nullable: true },
            { jsonPath: "unit_price.amount", columnName: "unit_price", dataType: "FLOAT", nullable: true },
            { jsonPath: "unit_price.currency", columnName: "unit_price_currency", dataType: "STRING", nullable: true },
          ] },
        ],
      },
    },
    { slug: "v2-labels", name: "Labels", description: "Shipping labels with tracking, costs, and carrier details", endpoint: "/v2/labels", responseRoot: "labels", incrementalKey: "created_at", schema: { columns: [
      { jsonPath: "label_id", columnName: "label_id", dataType: "STRING", nullable: false },
      { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
      { jsonPath: "shipment_id", columnName: "shipment_id", dataType: "STRING", nullable: true },
      { jsonPath: "ship_date", columnName: "ship_date", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "tracking_number", columnName: "tracking_number", dataType: "STRING", nullable: true },
      { jsonPath: "tracking_status", columnName: "tracking_status", dataType: "STRING", nullable: true },
      { jsonPath: "trackable", columnName: "trackable", dataType: "BOOLEAN", nullable: true },
      { jsonPath: "carrier_id", columnName: "carrier_id", dataType: "STRING", nullable: true },
      { jsonPath: "carrier_code", columnName: "carrier_code", dataType: "STRING", nullable: true },
      { jsonPath: "service_code", columnName: "service_code", dataType: "STRING", nullable: true },
      { jsonPath: "package_code", columnName: "package_code", dataType: "STRING", nullable: true },
      { jsonPath: "batch_id", columnName: "batch_id", dataType: "STRING", nullable: true },
      { jsonPath: "shipment_cost.amount", columnName: "shipment_cost", dataType: "FLOAT", nullable: true },
      { jsonPath: "shipment_cost.currency", columnName: "shipment_cost_currency", dataType: "STRING", nullable: true },
      { jsonPath: "insurance_cost.amount", columnName: "insurance_cost", dataType: "FLOAT", nullable: true },
      { jsonPath: "is_return_label", columnName: "is_return_label", dataType: "BOOLEAN", nullable: true },
      { jsonPath: "is_international", columnName: "is_international", dataType: "BOOLEAN", nullable: true },
      { jsonPath: "voided", columnName: "voided", dataType: "BOOLEAN", nullable: true },
      { jsonPath: "voided_at", columnName: "voided_at", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "test_label", columnName: "test_label", dataType: "BOOLEAN", nullable: true },
      { jsonPath: "label_format", columnName: "label_format", dataType: "STRING", nullable: true },
      { jsonPath: "charge_event", columnName: "charge_event", dataType: "STRING", nullable: true },
    ] } },
    { slug: "v2-carriers", name: "Carriers", description: "Shipping carriers connected to the account", endpoint: "/v2/carriers", responseRoot: "carriers", schema: { columns: [
      { jsonPath: "carrier_id", columnName: "carrier_id", dataType: "STRING", nullable: false },
      { jsonPath: "carrier_code", columnName: "carrier_code", dataType: "STRING", nullable: true },
      { jsonPath: "account_number", columnName: "account_number", dataType: "STRING", nullable: true },
      { jsonPath: "requires_funded_amount", columnName: "requires_funded_amount", dataType: "BOOLEAN", nullable: true },
      { jsonPath: "balance", columnName: "balance", dataType: "FLOAT", nullable: true },
      { jsonPath: "nickname", columnName: "nickname", dataType: "STRING", nullable: true },
      { jsonPath: "friendly_name", columnName: "friendly_name", dataType: "STRING", nullable: true },
      { jsonPath: "primary", columnName: "is_primary", dataType: "BOOLEAN", nullable: true },
    ] } },
    { slug: "v2-fulfillments", name: "Fulfillments", description: "Completed fulfillments with tracking and delivery info", endpoint: "/v2/fulfillments", responseRoot: "fulfillments", incrementalKey: "created_at", schema: { columns: [
      { jsonPath: "fulfillment_id", columnName: "fulfillment_id", dataType: "STRING", nullable: false },
      { jsonPath: "shipment_id", columnName: "shipment_id", dataType: "STRING", nullable: true },
      { jsonPath: "shipment_number", columnName: "shipment_number", dataType: "STRING", nullable: true },
      { jsonPath: "tracking_number", columnName: "tracking_number", dataType: "STRING", nullable: true },
      { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "ship_date", columnName: "ship_date", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "delivered_at", columnName: "delivered_at", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "voided", columnName: "voided", dataType: "BOOLEAN", nullable: true },
      { jsonPath: "fulfillment_carrier_friendly_name", columnName: "carrier_name", dataType: "STRING", nullable: true },
      { jsonPath: "fulfillment_fee.amount", columnName: "fee_amount", dataType: "FLOAT", nullable: true },
      { jsonPath: "fulfillment_fee.currency", columnName: "fee_currency", dataType: "STRING", nullable: true },
      { jsonPath: "ship_to.name", columnName: "ship_to_name", dataType: "STRING", nullable: true },
      { jsonPath: "ship_to.city_locality", columnName: "ship_to_city", dataType: "STRING", nullable: true },
      { jsonPath: "ship_to.state_province", columnName: "ship_to_state", dataType: "STRING", nullable: true },
      { jsonPath: "ship_to.postal_code", columnName: "ship_to_postal_code", dataType: "STRING", nullable: true },
      { jsonPath: "ship_to.country_code", columnName: "ship_to_country", dataType: "STRING", nullable: true },
    ] } },
    { slug: "v2-inventory", name: "Inventory", description: "SKU-level inventory quantities", endpoint: "/v2/inventory", responseRoot: "inventory", schema: { columns: [
      { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: false },
      { jsonPath: "on_hand", columnName: "on_hand", dataType: "INTEGER", nullable: true },
      { jsonPath: "allocated", columnName: "allocated", dataType: "INTEGER", nullable: true },
      { jsonPath: "available", columnName: "available", dataType: "INTEGER", nullable: true },
      { jsonPath: "average_cost.amount", columnName: "average_cost", dataType: "FLOAT", nullable: true },
      { jsonPath: "average_cost.currency", columnName: "average_cost_currency", dataType: "STRING", nullable: true },
      { jsonPath: "inventory_warehouse_id", columnName: "inventory_warehouse_id", dataType: "STRING", nullable: true },
    ] } },
    { slug: "v2-inventory-warehouses", name: "Inventory Warehouses", description: "Inventory warehouse definitions", endpoint: "/v2/inventory_warehouses", responseRoot: "inventory_warehouses", schema: { columns: [
      { jsonPath: "inventory_warehouse_id", columnName: "inventory_warehouse_id", dataType: "STRING", nullable: false },
      { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
      { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "updated_at", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
    ] } },
    { slug: "v2-batches", name: "Batches", description: "Label batches for bulk shipping", endpoint: "/v2/batches", responseRoot: "batches", incrementalKey: "created_at", schema: { columns: [
      { jsonPath: "batch_id", columnName: "batch_id", dataType: "STRING", nullable: false },
      { jsonPath: "external_batch_id", columnName: "external_batch_id", dataType: "STRING", nullable: true },
      { jsonPath: "batch_number", columnName: "batch_number", dataType: "STRING", nullable: true },
      { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
      { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "completed_at", columnName: "completed_at", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "count", columnName: "shipment_count", dataType: "INTEGER", nullable: true },
    ] } },
    { slug: "v2-manifests", name: "Manifests", description: "End-of-day manifests for carrier pickup", endpoint: "/v2/manifests", responseRoot: "manifests", incrementalKey: "created_at", schema: { columns: [
      { jsonPath: "manifest_id", columnName: "manifest_id", dataType: "STRING", nullable: false },
      { jsonPath: "carrier_id", columnName: "carrier_id", dataType: "STRING", nullable: true },
      { jsonPath: "warehouse_id", columnName: "warehouse_id", dataType: "STRING", nullable: true },
      { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "ship_date", columnName: "ship_date", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "shipments", columnName: "shipment_count", dataType: "INTEGER", nullable: true },
      { jsonPath: "manifest_download.href", columnName: "download_url", dataType: "STRING", nullable: true },
    ] } },
    { slug: "v2-warehouses", name: "Warehouses", description: "Ship-from warehouses with addresses", endpoint: "/v2/warehouses", responseRoot: "warehouses", schema: { columns: [
      { jsonPath: "warehouse_id", columnName: "warehouse_id", dataType: "STRING", nullable: false },
      { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
      { jsonPath: "is_default", columnName: "is_default", dataType: "BOOLEAN", nullable: true },
      { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "origin_address.name", columnName: "origin_name", dataType: "STRING", nullable: true },
      { jsonPath: "origin_address.city_locality", columnName: "origin_city", dataType: "STRING", nullable: true },
      { jsonPath: "origin_address.state_province", columnName: "origin_state", dataType: "STRING", nullable: true },
      { jsonPath: "origin_address.postal_code", columnName: "origin_postal_code", dataType: "STRING", nullable: true },
      { jsonPath: "origin_address.country_code", columnName: "origin_country", dataType: "STRING", nullable: true },
    ] } },
    { slug: "v2-packages", name: "Custom Packages", description: "Custom package type definitions", endpoint: "/v2/packages", responseRoot: "packages", schema: { columns: [
      { jsonPath: "package_id", columnName: "package_id", dataType: "STRING", nullable: false },
      { jsonPath: "package_code", columnName: "package_code", dataType: "STRING", nullable: true },
      { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
      { jsonPath: "dimensions.length", columnName: "length", dataType: "FLOAT", nullable: true },
      { jsonPath: "dimensions.width", columnName: "width", dataType: "FLOAT", nullable: true },
      { jsonPath: "dimensions.height", columnName: "height", dataType: "FLOAT", nullable: true },
    ] } },
    { slug: "v2-products", name: "Products", description: "Product catalog with SKUs, dimensions, and shipping defaults", endpoint: "/v2/products", responseRoot: "products", incrementalKey: "modify_date", schema: { columns: [
      { jsonPath: "product_id", columnName: "product_id", dataType: "INTEGER", nullable: false },
      { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: true },
      { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
      { jsonPath: "active", columnName: "active", dataType: "BOOLEAN", nullable: true },
      { jsonPath: "price.amount", columnName: "price", dataType: "FLOAT", nullable: true },
      { jsonPath: "weight.value", columnName: "weight_value", dataType: "FLOAT", nullable: true },
      { jsonPath: "weight.unit", columnName: "weight_unit", dataType: "STRING", nullable: true },
      { jsonPath: "dimensions.length", columnName: "length", dataType: "FLOAT", nullable: true },
      { jsonPath: "dimensions.width", columnName: "width", dataType: "FLOAT", nullable: true },
      { jsonPath: "dimensions.height", columnName: "height", dataType: "FLOAT", nullable: true },
      { jsonPath: "fulfillment_sku", columnName: "fulfillment_sku", dataType: "STRING", nullable: true },
      { jsonPath: "warehouse_location", columnName: "warehouse_location", dataType: "STRING", nullable: true },
      { jsonPath: "create_date", columnName: "create_date", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "modify_date", columnName: "modify_date", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "customs_value", columnName: "customs_value", dataType: "FLOAT", nullable: true },
      { jsonPath: "product_type", columnName: "product_type", dataType: "STRING", nullable: true },
      { jsonPath: "is_bundle", columnName: "is_bundle", dataType: "BOOLEAN", nullable: true },
    ] } },
    { slug: "v2-purchase-orders", name: "Purchase Orders", description: "Purchase orders from suppliers", endpoint: "/v2/purchase_orders", responseRoot: "purchase_orders", incrementalKey: "modify_date", schema: { columns: [
      { jsonPath: "purchase_order_id", columnName: "purchase_order_id", dataType: "STRING", nullable: false },
      { jsonPath: "order_number", columnName: "order_number", dataType: "STRING", nullable: true },
      { jsonPath: "supplier_id", columnName: "supplier_id", dataType: "STRING", nullable: true },
      { jsonPath: "supplier_name", columnName: "supplier_name", dataType: "STRING", nullable: true },
      { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
      { jsonPath: "order_date", columnName: "order_date", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "expected_delivery_date", columnName: "expected_delivery_date", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "create_date", columnName: "create_date", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "modify_date", columnName: "modify_date", dataType: "TIMESTAMP", nullable: true },
      { jsonPath: "warehouse_id", columnName: "warehouse_id", dataType: "STRING", nullable: true },
    ] } },
    { slug: "v2-suppliers", name: "Suppliers", description: "Supplier contact and address info", endpoint: "/v2/suppliers", responseRoot: "suppliers", schema: { columns: [
      { jsonPath: "supplier_id", columnName: "supplier_id", dataType: "STRING", nullable: false },
      { jsonPath: "supplier_name", columnName: "supplier_name", dataType: "STRING", nullable: true },
      { jsonPath: "supplier_email", columnName: "supplier_email", dataType: "STRING", nullable: true },
      { jsonPath: "contact_name", columnName: "contact_name", dataType: "STRING", nullable: true },
      { jsonPath: "city", columnName: "city", dataType: "STRING", nullable: true },
      { jsonPath: "state", columnName: "state", dataType: "STRING", nullable: true },
      { jsonPath: "postal_code", columnName: "postal_code", dataType: "STRING", nullable: true },
      { jsonPath: "country_code", columnName: "country_code", dataType: "STRING", nullable: true },
    ] } },
    { slug: "v2-totes", name: "Totes", description: "Warehouse totes for picking and packing", endpoint: "/v2/totes", responseRoot: "totes", schema: { columns: [
      { jsonPath: "tote_id", columnName: "tote_id", dataType: "STRING", nullable: false },
      { jsonPath: "inventory_warehouse_id", columnName: "inventory_warehouse_id", dataType: "STRING", nullable: true },
      { jsonPath: "tote_name", columnName: "tote_name", dataType: "STRING", nullable: true },
      { jsonPath: "tote_barcode", columnName: "tote_barcode", dataType: "STRING", nullable: true },
      { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
    ] } },
    { slug: "v2-tags", name: "Tags", description: "Custom tags for categorizing shipments", endpoint: "/v2/tags", responseRoot: "tags", schema: { columns: [
      { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: false },
    ] } },
    { slug: "v2-webhooks", name: "Webhooks", description: "Webhook subscriptions", endpoint: "/v2/environment/webhooks", responseRoot: "webhooks", schema: { columns: [
      { jsonPath: "webhook_id", columnName: "webhook_id", dataType: "STRING", nullable: false },
      { jsonPath: "url", columnName: "url", dataType: "STRING", nullable: true },
      { jsonPath: "event", columnName: "event", dataType: "STRING", nullable: true },
    ] } },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 2. Shopify
// ───────────────────────────────────────────────────────────────────────────
const shopify: ConnectorDef = {
  slug: "shopify",
  name: "Shopify",
  description: "E-commerce platform for online stores and retail point-of-sale",
  category: "E-Commerce",
  docsUrl: "https://shopify.dev/docs/api/admin-rest",
  popularity: 95,
  authType: "API_KEY",
  baseUrl: "https://{store}.myshopify.com/admin/api/2024-01",
  authConfig: {
    fields: [
      { key: "apiKey", label: "Access Token", type: "password", placeholder: "shpat_xxxxx", required: true },
    ],
    headerName: "X-Shopify-Access-Token",
    urlPlaceholders: ["store"],
  },
  pagination: {
    type: "link_header",
    limitParam: "limit",
    defaultLimit: 250,
  },
  rateLimiting: { leakyBucket: true, maxRequests: 40, restoreRate: 2 },
  objects: [
    {
      slug: "orders",
      name: "Orders",
      description: "Customer orders including line items and fulfillments",
      endpoint: "/orders.json",
      responseRoot: "orders",
      incrementalKey: "updated_at",
      defaultParams: { status: "any" },
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: false },
          { jsonPath: "email", columnName: "email", dataType: "STRING", nullable: true },
          { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updated_at", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "closed_at", columnName: "closed_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "cancelled_at", columnName: "cancelled_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "financial_status", columnName: "financial_status", dataType: "STRING", nullable: true },
          { jsonPath: "fulfillment_status", columnName: "fulfillment_status", dataType: "STRING", nullable: true },
          { jsonPath: "total_price", columnName: "total_price", dataType: "STRING", nullable: true },
          { jsonPath: "subtotal_price", columnName: "subtotal_price", dataType: "STRING", nullable: true },
          { jsonPath: "total_tax", columnName: "total_tax", dataType: "STRING", nullable: true },
          { jsonPath: "total_discounts", columnName: "total_discounts", dataType: "STRING", nullable: true },
          { jsonPath: "total_shipping_price_set.shop_money.amount", columnName: "total_shipping", dataType: "STRING", nullable: true },
          { jsonPath: "currency", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "order_number", columnName: "order_number", dataType: "INTEGER", nullable: true },
          { jsonPath: "test", columnName: "test", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "customer.id", columnName: "customer_id", dataType: "INTEGER", nullable: true },
          { jsonPath: "customer.email", columnName: "customer_email", dataType: "STRING", nullable: true },
          { jsonPath: "shipping_address.city", columnName: "shipping_city", dataType: "STRING", nullable: true },
          { jsonPath: "shipping_address.province", columnName: "shipping_province", dataType: "STRING", nullable: true },
          { jsonPath: "shipping_address.country", columnName: "shipping_country", dataType: "STRING", nullable: true },
          { jsonPath: "shipping_address.zip", columnName: "shipping_zip", dataType: "STRING", nullable: true },
          { jsonPath: "tags", columnName: "tags", dataType: "STRING", nullable: true },
          { jsonPath: "note", columnName: "note", dataType: "STRING", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "line_items",
            tableName: "orders_line_items",
            foreignKey: "order_id",
            columns: [
              { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
              { jsonPath: "title", columnName: "title", dataType: "STRING", nullable: true },
              { jsonPath: "quantity", columnName: "quantity", dataType: "INTEGER", nullable: true },
              { jsonPath: "price", columnName: "price", dataType: "STRING", nullable: true },
              { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: true },
              { jsonPath: "variant_id", columnName: "variant_id", dataType: "INTEGER", nullable: true },
              { jsonPath: "product_id", columnName: "product_id", dataType: "INTEGER", nullable: true },
              { jsonPath: "variant_title", columnName: "variant_title", dataType: "STRING", nullable: true },
              { jsonPath: "vendor", columnName: "vendor", dataType: "STRING", nullable: true },
              { jsonPath: "fulfillment_status", columnName: "fulfillment_status", dataType: "STRING", nullable: true },
              { jsonPath: "total_discount", columnName: "total_discount", dataType: "STRING", nullable: true },
              { jsonPath: "taxable", columnName: "taxable", dataType: "BOOLEAN", nullable: true },
            ],
          },
        ],
      },
    },
    {
      slug: "products",
      name: "Products",
      description: "Product catalog with variants and images",
      endpoint: "/products.json",
      responseRoot: "products",
      incrementalKey: "updated_at",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "title", columnName: "title", dataType: "STRING", nullable: true },
          { jsonPath: "body_html", columnName: "body_html", dataType: "STRING", nullable: true },
          { jsonPath: "vendor", columnName: "vendor", dataType: "STRING", nullable: true },
          { jsonPath: "product_type", columnName: "product_type", dataType: "STRING", nullable: true },
          { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updated_at", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "published_at", columnName: "published_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "handle", columnName: "handle", dataType: "STRING", nullable: true },
          { jsonPath: "template_suffix", columnName: "template_suffix", dataType: "STRING", nullable: true },
          { jsonPath: "published_scope", columnName: "published_scope", dataType: "STRING", nullable: true },
          { jsonPath: "tags", columnName: "tags", dataType: "STRING", nullable: true },
          { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "image.src", columnName: "image_src", dataType: "STRING", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "variants",
            tableName: "products_variants",
            foreignKey: "product_id",
            columns: [
              { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
              { jsonPath: "title", columnName: "title", dataType: "STRING", nullable: true },
              { jsonPath: "price", columnName: "price", dataType: "STRING", nullable: true },
              { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: true },
              { jsonPath: "position", columnName: "position", dataType: "INTEGER", nullable: true },
              { jsonPath: "inventory_quantity", columnName: "inventory_quantity", dataType: "INTEGER", nullable: true },
              { jsonPath: "compare_at_price", columnName: "compare_at_price", dataType: "STRING", nullable: true },
              { jsonPath: "option1", columnName: "option1", dataType: "STRING", nullable: true },
              { jsonPath: "option2", columnName: "option2", dataType: "STRING", nullable: true },
              { jsonPath: "option3", columnName: "option3", dataType: "STRING", nullable: true },
              { jsonPath: "barcode", columnName: "barcode", dataType: "STRING", nullable: true },
              { jsonPath: "weight", columnName: "weight", dataType: "FLOAT", nullable: true },
              { jsonPath: "weight_unit", columnName: "weight_unit", dataType: "STRING", nullable: true },
            ],
          },
        ],
      },
    },
    {
      slug: "customers",
      name: "Customers",
      description: "Customer records with addresses and order history",
      endpoint: "/customers.json",
      responseRoot: "customers",
      incrementalKey: "updated_at",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "email", columnName: "email", dataType: "STRING", nullable: true },
          { jsonPath: "first_name", columnName: "first_name", dataType: "STRING", nullable: true },
          { jsonPath: "last_name", columnName: "last_name", dataType: "STRING", nullable: true },
          { jsonPath: "orders_count", columnName: "orders_count", dataType: "INTEGER", nullable: true },
          { jsonPath: "state", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "total_spent", columnName: "total_spent", dataType: "STRING", nullable: true },
          { jsonPath: "verified_email", columnName: "verified_email", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "tax_exempt", columnName: "tax_exempt", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "phone", columnName: "phone", dataType: "STRING", nullable: true },
          { jsonPath: "tags", columnName: "tags", dataType: "STRING", nullable: true },
          { jsonPath: "currency", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updated_at", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "default_address.city", columnName: "default_city", dataType: "STRING", nullable: true },
          { jsonPath: "default_address.province", columnName: "default_province", dataType: "STRING", nullable: true },
          { jsonPath: "default_address.country", columnName: "default_country", dataType: "STRING", nullable: true },
          { jsonPath: "default_address.zip", columnName: "default_zip", dataType: "STRING", nullable: true },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 3. Stripe
// ───────────────────────────────────────────────────────────────────────────
const stripe: ConnectorDef = {
  slug: "stripe",
  name: "Stripe",
  description: "Online payment processing platform for internet businesses",
  category: "Payments",
  docsUrl: "https://stripe.com/docs/api",
  popularity: 98,
  authType: "BEARER",
  baseUrl: "https://api.stripe.com/v1",
  authConfig: {
    fields: [
      { key: "bearerToken", label: "Secret Key", type: "password", placeholder: "sk_live_xxxxx", required: true },
    ],
    tokenPrefix: "Bearer",
  },
  pagination: {
    type: "cursor",
    pageParam: "starting_after",
    limitParam: "limit",
    defaultLimit: 100,
    cursorPath: "data[-1].id",
    hasMorePath: "has_more",
  },
  rateLimiting: { requestsPerSecond: 25 },
  objects: [
    {
      slug: "charges",
      name: "Charges",
      description: "Payment charges created via the API or checkout",
      endpoint: "/charges",
      responseRoot: "data",
      incrementalKey: "created",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "amount", columnName: "amount", dataType: "INTEGER", nullable: false },
          { jsonPath: "amount_captured", columnName: "amount_captured", dataType: "INTEGER", nullable: true },
          { jsonPath: "amount_refunded", columnName: "amount_refunded", dataType: "INTEGER", nullable: true },
          { jsonPath: "currency", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "created", columnName: "created", dataType: "INTEGER", nullable: true },
          { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "paid", columnName: "paid", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "refunded", columnName: "refunded", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "captured", columnName: "captured", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "disputed", columnName: "disputed", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "customer", columnName: "customer_id", dataType: "STRING", nullable: true },
          { jsonPath: "invoice", columnName: "invoice_id", dataType: "STRING", nullable: true },
          { jsonPath: "payment_intent", columnName: "payment_intent_id", dataType: "STRING", nullable: true },
          { jsonPath: "payment_method", columnName: "payment_method_id", dataType: "STRING", nullable: true },
          { jsonPath: "description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "receipt_email", columnName: "receipt_email", dataType: "STRING", nullable: true },
          { jsonPath: "receipt_url", columnName: "receipt_url", dataType: "STRING", nullable: true },
          { jsonPath: "failure_code", columnName: "failure_code", dataType: "STRING", nullable: true },
          { jsonPath: "failure_message", columnName: "failure_message", dataType: "STRING", nullable: true },
          { jsonPath: "billing_details.name", columnName: "billing_name", dataType: "STRING", nullable: true },
          { jsonPath: "billing_details.email", columnName: "billing_email", dataType: "STRING", nullable: true },
          { jsonPath: "billing_details.address.country", columnName: "billing_country", dataType: "STRING", nullable: true },
          { jsonPath: "billing_details.address.postal_code", columnName: "billing_postal_code", dataType: "STRING", nullable: true },
        ],
      },
    },
    {
      slug: "customers",
      name: "Customers",
      description: "Customer records with billing and payment methods",
      endpoint: "/customers",
      responseRoot: "data",
      incrementalKey: "created",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "email", columnName: "email", dataType: "STRING", nullable: true },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "phone", columnName: "phone", dataType: "STRING", nullable: true },
          { jsonPath: "description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "created", columnName: "created", dataType: "INTEGER", nullable: true },
          { jsonPath: "currency", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "balance", columnName: "balance", dataType: "INTEGER", nullable: true },
          { jsonPath: "delinquent", columnName: "delinquent", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "default_source", columnName: "default_source", dataType: "STRING", nullable: true },
          { jsonPath: "invoice_prefix", columnName: "invoice_prefix", dataType: "STRING", nullable: true },
          { jsonPath: "livemode", columnName: "livemode", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "address.city", columnName: "address_city", dataType: "STRING", nullable: true },
          { jsonPath: "address.state", columnName: "address_state", dataType: "STRING", nullable: true },
          { jsonPath: "address.country", columnName: "address_country", dataType: "STRING", nullable: true },
          { jsonPath: "address.postal_code", columnName: "address_postal_code", dataType: "STRING", nullable: true },
          { jsonPath: "tax_exempt", columnName: "tax_exempt", dataType: "STRING", nullable: true },
        ],
      },
    },
    {
      slug: "invoices",
      name: "Invoices",
      description: "Invoices for one-time or subscription billing",
      endpoint: "/invoices",
      responseRoot: "data",
      incrementalKey: "created",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "customer", columnName: "customer_id", dataType: "STRING", nullable: true },
          { jsonPath: "subscription", columnName: "subscription_id", dataType: "STRING", nullable: true },
          { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "created", columnName: "created", dataType: "INTEGER", nullable: true },
          { jsonPath: "due_date", columnName: "due_date", dataType: "INTEGER", nullable: true },
          { jsonPath: "amount_due", columnName: "amount_due", dataType: "INTEGER", nullable: true },
          { jsonPath: "amount_paid", columnName: "amount_paid", dataType: "INTEGER", nullable: true },
          { jsonPath: "amount_remaining", columnName: "amount_remaining", dataType: "INTEGER", nullable: true },
          { jsonPath: "total", columnName: "total", dataType: "INTEGER", nullable: true },
          { jsonPath: "subtotal", columnName: "subtotal", dataType: "INTEGER", nullable: true },
          { jsonPath: "tax", columnName: "tax", dataType: "INTEGER", nullable: true },
          { jsonPath: "currency", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "number", columnName: "number", dataType: "STRING", nullable: true },
          { jsonPath: "paid", columnName: "paid", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "attempted", columnName: "attempted", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "attempt_count", columnName: "attempt_count", dataType: "INTEGER", nullable: true },
          { jsonPath: "hosted_invoice_url", columnName: "hosted_invoice_url", dataType: "STRING", nullable: true },
          { jsonPath: "invoice_pdf", columnName: "invoice_pdf", dataType: "STRING", nullable: true },
          { jsonPath: "period_start", columnName: "period_start", dataType: "INTEGER", nullable: true },
          { jsonPath: "period_end", columnName: "period_end", dataType: "INTEGER", nullable: true },
          { jsonPath: "customer_email", columnName: "customer_email", dataType: "STRING", nullable: true },
          { jsonPath: "customer_name", columnName: "customer_name", dataType: "STRING", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "lines.data",
            tableName: "invoices_line_items",
            foreignKey: "invoice_id",
            columns: [
              { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
              { jsonPath: "description", columnName: "description", dataType: "STRING", nullable: true },
              { jsonPath: "amount", columnName: "amount", dataType: "INTEGER", nullable: true },
              { jsonPath: "quantity", columnName: "quantity", dataType: "INTEGER", nullable: true },
              { jsonPath: "currency", columnName: "currency", dataType: "STRING", nullable: true },
              { jsonPath: "price.id", columnName: "price_id", dataType: "STRING", nullable: true },
              { jsonPath: "price.unit_amount", columnName: "unit_amount", dataType: "INTEGER", nullable: true },
            ],
          },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 4. HubSpot
// ───────────────────────────────────────────────────────────────────────────
const hubspot: ConnectorDef = {
  slug: "hubspot",
  name: "HubSpot",
  description: "CRM platform for marketing, sales, and customer service",
  category: "CRM",
  docsUrl: "https://developers.hubspot.com/docs/api/crm/contacts",
  popularity: 90,
  authType: "BEARER",
  baseUrl: "https://api.hubapi.com/crm/v3",
  authConfig: {
    fields: [
      { key: "bearerToken", label: "Private App Token", type: "password", placeholder: "pat-xxxxx", required: true },
    ],
    tokenPrefix: "Bearer",
  },
  pagination: {
    type: "cursor",
    pageParam: "after",
    limitParam: "limit",
    defaultLimit: 100,
    cursorPath: "paging.next.after",
  },
  rateLimiting: { requestsPerSecond: 10 },
  objects: [
    {
      slug: "contacts",
      name: "Contacts",
      description: "CRM contact records with properties",
      endpoint: "/objects/contacts",
      responseRoot: "results",
      incrementalKey: "updatedAt",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "properties.email", columnName: "email", dataType: "STRING", nullable: true },
          { jsonPath: "properties.firstname", columnName: "firstname", dataType: "STRING", nullable: true },
          { jsonPath: "properties.lastname", columnName: "lastname", dataType: "STRING", nullable: true },
          { jsonPath: "properties.phone", columnName: "phone", dataType: "STRING", nullable: true },
          { jsonPath: "properties.company", columnName: "company", dataType: "STRING", nullable: true },
          { jsonPath: "properties.jobtitle", columnName: "jobtitle", dataType: "STRING", nullable: true },
          { jsonPath: "properties.lifecyclestage", columnName: "lifecycle_stage", dataType: "STRING", nullable: true },
          { jsonPath: "properties.hs_lead_status", columnName: "lead_status", dataType: "STRING", nullable: true },
          { jsonPath: "properties.city", columnName: "city", dataType: "STRING", nullable: true },
          { jsonPath: "properties.state", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "properties.country", columnName: "country", dataType: "STRING", nullable: true },
          { jsonPath: "properties.zip", columnName: "zip", dataType: "STRING", nullable: true },
          { jsonPath: "properties.website", columnName: "website", dataType: "STRING", nullable: true },
          { jsonPath: "properties.createdate", columnName: "create_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "properties.lastmodifieddate", columnName: "last_modified_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "properties.hs_object_id", columnName: "hs_object_id", dataType: "STRING", nullable: true },
          { jsonPath: "createdAt", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updatedAt", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "archived", columnName: "archived", dataType: "BOOLEAN", nullable: true },
        ],
      },
    },
    {
      slug: "companies",
      name: "Companies",
      description: "CRM company records with properties",
      endpoint: "/objects/companies",
      responseRoot: "results",
      incrementalKey: "updatedAt",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "properties.name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "properties.domain", columnName: "domain", dataType: "STRING", nullable: true },
          { jsonPath: "properties.industry", columnName: "industry", dataType: "STRING", nullable: true },
          { jsonPath: "properties.phone", columnName: "phone", dataType: "STRING", nullable: true },
          { jsonPath: "properties.city", columnName: "city", dataType: "STRING", nullable: true },
          { jsonPath: "properties.state", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "properties.country", columnName: "country", dataType: "STRING", nullable: true },
          { jsonPath: "properties.zip", columnName: "zip", dataType: "STRING", nullable: true },
          { jsonPath: "properties.numberofemployees", columnName: "number_of_employees", dataType: "STRING", nullable: true },
          { jsonPath: "properties.annualrevenue", columnName: "annual_revenue", dataType: "STRING", nullable: true },
          { jsonPath: "properties.lifecyclestage", columnName: "lifecycle_stage", dataType: "STRING", nullable: true },
          { jsonPath: "properties.createdate", columnName: "create_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "properties.hs_lastmodifieddate", columnName: "last_modified_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "properties.description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "properties.website", columnName: "website", dataType: "STRING", nullable: true },
          { jsonPath: "createdAt", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updatedAt", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "archived", columnName: "archived", dataType: "BOOLEAN", nullable: true },
        ],
      },
    },
    {
      slug: "deals",
      name: "Deals",
      description: "CRM deal/opportunity records",
      endpoint: "/objects/deals",
      responseRoot: "results",
      incrementalKey: "updatedAt",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "properties.dealname", columnName: "deal_name", dataType: "STRING", nullable: true },
          { jsonPath: "properties.amount", columnName: "amount", dataType: "STRING", nullable: true },
          { jsonPath: "properties.dealstage", columnName: "deal_stage", dataType: "STRING", nullable: true },
          { jsonPath: "properties.pipeline", columnName: "pipeline", dataType: "STRING", nullable: true },
          { jsonPath: "properties.closedate", columnName: "close_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "properties.createdate", columnName: "create_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "properties.hs_lastmodifieddate", columnName: "last_modified_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "properties.hubspot_owner_id", columnName: "owner_id", dataType: "STRING", nullable: true },
          { jsonPath: "properties.deal_currency_code", columnName: "currency_code", dataType: "STRING", nullable: true },
          { jsonPath: "properties.hs_deal_stage_probability", columnName: "stage_probability", dataType: "STRING", nullable: true },
          { jsonPath: "properties.hs_forecast_amount", columnName: "forecast_amount", dataType: "STRING", nullable: true },
          { jsonPath: "properties.hs_priority", columnName: "priority", dataType: "STRING", nullable: true },
          { jsonPath: "properties.description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "createdAt", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updatedAt", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "archived", columnName: "archived", dataType: "BOOLEAN", nullable: true },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 5. Airtable
// ───────────────────────────────────────────────────────────────────────────
const airtable: ConnectorDef = {
  slug: "airtable",
  name: "Airtable",
  description: "Cloud-based spreadsheet-database hybrid for team collaboration",
  category: "Productivity",
  docsUrl: "https://airtable.com/developers/web/api/introduction",
  popularity: 75,
  authType: "BEARER",
  baseUrl: "https://api.airtable.com/v0",
  authConfig: {
    fields: [
      { key: "bearerToken", label: "Personal Access Token", type: "password", placeholder: "pat_xxxxx", required: true },
      { key: "baseId", label: "Base ID", type: "text", placeholder: "appXXXXXXXXXXXX", required: true },
      { key: "tableId", label: "Table ID or Name", type: "text", placeholder: "tblXXXXXXXXXXXX or Table Name", required: true },
    ],
    tokenPrefix: "Bearer",
    urlPlaceholders: ["baseId", "tableId"],
  },
  pagination: {
    type: "cursor",
    pageParam: "offset",
    limitParam: "pageSize",
    defaultLimit: 100,
    cursorPath: "offset",
  },
  objects: [
    {
      slug: "records",
      name: "Records",
      description: "Table records from the specified base and table",
      endpoint: "/{baseId}/{tableId}",
      responseRoot: "records",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "createdTime", columnName: "created_time", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "fields", columnName: "fields", dataType: "JSON", nullable: true },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 6. Monday.com
// ───────────────────────────────────────────────────────────────────────────
const mondayCom: ConnectorDef = {
  slug: "monday",
  name: "Monday.com",
  description: "Work operating system for project and team management",
  category: "Productivity",
  docsUrl: "https://developer.monday.com/api-reference/reference/boards",
  popularity: 70,
  authType: "API_KEY",
  baseUrl: "https://api.monday.com/v2",
  authConfig: {
    fields: [
      { key: "apiKey", label: "API Token", type: "password", placeholder: "eyJhbGciOi...", required: true },
    ],
    headerName: "Authorization",
  },
  pagination: {
    type: "cursor",
    pageParam: "cursor",
    defaultLimit: 100,
    cursorPath: "next_items_page.cursor",
  },
  objects: [
    {
      slug: "boards",
      name: "Boards",
      description: "Project boards with columns and groups",
      endpoint: "/",
      method: "POST",
      responseRoot: "data.boards",
      defaultParams: {
        query: "{ boards(limit: 100) { id name description state board_kind created_at updated_at owner { id email } columns { id title type } groups { id title color } } }",
      },
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "state", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "board_kind", columnName: "board_kind", dataType: "STRING", nullable: true },
          { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updated_at", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "owner.id", columnName: "owner_id", dataType: "STRING", nullable: true },
          { jsonPath: "owner.email", columnName: "owner_email", dataType: "STRING", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "columns",
            tableName: "boards_columns",
            foreignKey: "board_id",
            columns: [
              { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
              { jsonPath: "title", columnName: "title", dataType: "STRING", nullable: true },
              { jsonPath: "type", columnName: "type", dataType: "STRING", nullable: true },
            ],
          },
          {
            jsonPath: "groups",
            tableName: "boards_groups",
            foreignKey: "board_id",
            columns: [
              { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
              { jsonPath: "title", columnName: "title", dataType: "STRING", nullable: true },
              { jsonPath: "color", columnName: "color", dataType: "STRING", nullable: true },
            ],
          },
        ],
      },
    },
    {
      slug: "items",
      name: "Items",
      description: "Board items (rows) with column values",
      endpoint: "/",
      method: "POST",
      responseRoot: "data.boards[0].items_page.items",
      defaultParams: {
        query: '{ boards(ids: [BOARD_ID]) { items_page(limit: 100) { cursor items { id name created_at updated_at state group { id title } column_values { id text value type } } } } }',
      },
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updated_at", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "state", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "group.id", columnName: "group_id", dataType: "STRING", nullable: true },
          { jsonPath: "group.title", columnName: "group_title", dataType: "STRING", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "column_values",
            tableName: "items_column_values",
            foreignKey: "item_id",
            columns: [
              { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
              { jsonPath: "text", columnName: "text", dataType: "STRING", nullable: true },
              { jsonPath: "value", columnName: "value", dataType: "STRING", nullable: true },
              { jsonPath: "type", columnName: "type", dataType: "STRING", nullable: true },
            ],
          },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 7. Jira
// ───────────────────────────────────────────────────────────────────────────
const jira: ConnectorDef = {
  slug: "jira",
  name: "Jira",
  description: "Issue and project tracking for agile software teams",
  category: "Project Management",
  docsUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
  popularity: 88,
  authType: "BASIC",
  baseUrl: "https://{domain}.atlassian.net/rest/api/3",
  authConfig: {
    fields: [
      { key: "username", label: "Email Address", type: "text", placeholder: "user@company.com", required: true },
      { key: "password", label: "API Token", type: "password", placeholder: "Atlassian API token", required: true },
    ],
    urlPlaceholders: ["domain"],
  },
  pagination: {
    type: "offset",
    pageParam: "startAt",
    limitParam: "maxResults",
    defaultLimit: 50,
  },
  objects: [
    {
      slug: "issues",
      name: "Issues",
      description: "Jira issues (stories, bugs, tasks, epics)",
      endpoint: "/search",
      responseRoot: "issues",
      incrementalKey: "fields.updated",
      defaultParams: { jql: "ORDER BY updated DESC" },
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "key", columnName: "key", dataType: "STRING", nullable: false },
          { jsonPath: "self", columnName: "self_url", dataType: "STRING", nullable: true },
          { jsonPath: "fields.summary", columnName: "summary", dataType: "STRING", nullable: true },
          { jsonPath: "fields.description", columnName: "description", dataType: "JSON", nullable: true },
          { jsonPath: "fields.status.name", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "fields.status.statusCategory.name", columnName: "status_category", dataType: "STRING", nullable: true },
          { jsonPath: "fields.issuetype.name", columnName: "issue_type", dataType: "STRING", nullable: true },
          { jsonPath: "fields.priority.name", columnName: "priority", dataType: "STRING", nullable: true },
          { jsonPath: "fields.assignee.displayName", columnName: "assignee_name", dataType: "STRING", nullable: true },
          { jsonPath: "fields.assignee.emailAddress", columnName: "assignee_email", dataType: "STRING", nullable: true },
          { jsonPath: "fields.reporter.displayName", columnName: "reporter_name", dataType: "STRING", nullable: true },
          { jsonPath: "fields.reporter.emailAddress", columnName: "reporter_email", dataType: "STRING", nullable: true },
          { jsonPath: "fields.project.key", columnName: "project_key", dataType: "STRING", nullable: true },
          { jsonPath: "fields.project.name", columnName: "project_name", dataType: "STRING", nullable: true },
          { jsonPath: "fields.created", columnName: "created", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "fields.updated", columnName: "updated", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "fields.resolutiondate", columnName: "resolution_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "fields.resolution.name", columnName: "resolution", dataType: "STRING", nullable: true },
          { jsonPath: "fields.labels", columnName: "labels", dataType: "JSON", nullable: true },
          { jsonPath: "fields.components", columnName: "components", dataType: "JSON", nullable: true },
          { jsonPath: "fields.fixVersions", columnName: "fix_versions", dataType: "JSON", nullable: true },
          { jsonPath: "fields.story_points", columnName: "story_points", dataType: "FLOAT", nullable: true },
          { jsonPath: "fields.parent.key", columnName: "parent_key", dataType: "STRING", nullable: true },
          { jsonPath: "fields.sprint.name", columnName: "sprint_name", dataType: "STRING", nullable: true },
        ],
      },
    },
    {
      slug: "projects",
      name: "Projects",
      description: "Jira projects containing issues",
      endpoint: "/project",
      responseRoot: "$",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "key", columnName: "key", dataType: "STRING", nullable: false },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "self", columnName: "self_url", dataType: "STRING", nullable: true },
          { jsonPath: "projectTypeKey", columnName: "project_type_key", dataType: "STRING", nullable: true },
          { jsonPath: "simplified", columnName: "simplified", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "style", columnName: "style", dataType: "STRING", nullable: true },
          { jsonPath: "isPrivate", columnName: "is_private", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "lead.displayName", columnName: "lead_name", dataType: "STRING", nullable: true },
          { jsonPath: "lead.emailAddress", columnName: "lead_email", dataType: "STRING", nullable: true },
          { jsonPath: "description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "avatarUrls.48x48", columnName: "avatar_url", dataType: "STRING", nullable: true },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 8. WooCommerce
// ───────────────────────────────────────────────────────────────────────────
const wooCommerce: ConnectorDef = {
  slug: "woocommerce",
  name: "WooCommerce",
  description: "Open-source e-commerce plugin for WordPress",
  category: "E-Commerce",
  docsUrl: "https://woocommerce.github.io/woocommerce-rest-api-docs/",
  popularity: 82,
  authType: "BASIC",
  baseUrl: "https://{domain}/wp-json/wc/v3",
  authConfig: {
    fields: [
      { key: "username", label: "Consumer Key", type: "password", placeholder: "ck_xxxxx", required: true },
      { key: "password", label: "Consumer Secret", type: "password", placeholder: "cs_xxxxx", required: true },
      { key: "domain", label: "Store Domain", type: "text", placeholder: "mystore.com", required: true },
    ],
    urlPlaceholders: ["domain"],
  },
  pagination: {
    type: "page_number",
    pageParam: "page",
    limitParam: "per_page",
    defaultLimit: 100,
  },
  objects: [
    {
      slug: "orders",
      name: "Orders",
      description: "Customer orders with billing and shipping",
      endpoint: "/orders",
      responseRoot: "$",
      incrementalKey: "date_modified",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "number", columnName: "number", dataType: "STRING", nullable: true },
          { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "date_created", columnName: "date_created", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "date_modified", columnName: "date_modified", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "total", columnName: "total", dataType: "STRING", nullable: true },
          { jsonPath: "discount_total", columnName: "discount_total", dataType: "STRING", nullable: true },
          { jsonPath: "shipping_total", columnName: "shipping_total", dataType: "STRING", nullable: true },
          { jsonPath: "total_tax", columnName: "total_tax", dataType: "STRING", nullable: true },
          { jsonPath: "currency", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "payment_method", columnName: "payment_method", dataType: "STRING", nullable: true },
          { jsonPath: "payment_method_title", columnName: "payment_method_title", dataType: "STRING", nullable: true },
          { jsonPath: "customer_id", columnName: "customer_id", dataType: "INTEGER", nullable: true },
          { jsonPath: "customer_note", columnName: "customer_note", dataType: "STRING", nullable: true },
          { jsonPath: "billing.first_name", columnName: "billing_first_name", dataType: "STRING", nullable: true },
          { jsonPath: "billing.last_name", columnName: "billing_last_name", dataType: "STRING", nullable: true },
          { jsonPath: "billing.email", columnName: "billing_email", dataType: "STRING", nullable: true },
          { jsonPath: "billing.phone", columnName: "billing_phone", dataType: "STRING", nullable: true },
          { jsonPath: "billing.city", columnName: "billing_city", dataType: "STRING", nullable: true },
          { jsonPath: "billing.state", columnName: "billing_state", dataType: "STRING", nullable: true },
          { jsonPath: "billing.country", columnName: "billing_country", dataType: "STRING", nullable: true },
          { jsonPath: "shipping.city", columnName: "shipping_city", dataType: "STRING", nullable: true },
          { jsonPath: "shipping.state", columnName: "shipping_state", dataType: "STRING", nullable: true },
          { jsonPath: "shipping.country", columnName: "shipping_country", dataType: "STRING", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "line_items",
            tableName: "orders_line_items",
            foreignKey: "order_id",
            columns: [
              { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
              { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
              { jsonPath: "product_id", columnName: "product_id", dataType: "INTEGER", nullable: true },
              { jsonPath: "variation_id", columnName: "variation_id", dataType: "INTEGER", nullable: true },
              { jsonPath: "quantity", columnName: "quantity", dataType: "INTEGER", nullable: true },
              { jsonPath: "subtotal", columnName: "subtotal", dataType: "STRING", nullable: true },
              { jsonPath: "total", columnName: "total", dataType: "STRING", nullable: true },
              { jsonPath: "total_tax", columnName: "total_tax", dataType: "STRING", nullable: true },
              { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: true },
              { jsonPath: "price", columnName: "price", dataType: "FLOAT", nullable: true },
            ],
          },
        ],
      },
    },
    {
      slug: "products",
      name: "Products",
      description: "Product catalog with categories and variations",
      endpoint: "/products",
      responseRoot: "$",
      incrementalKey: "date_modified",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "slug", columnName: "slug", dataType: "STRING", nullable: true },
          { jsonPath: "type", columnName: "type", dataType: "STRING", nullable: true },
          { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: true },
          { jsonPath: "price", columnName: "price", dataType: "STRING", nullable: true },
          { jsonPath: "regular_price", columnName: "regular_price", dataType: "STRING", nullable: true },
          { jsonPath: "sale_price", columnName: "sale_price", dataType: "STRING", nullable: true },
          { jsonPath: "stock_quantity", columnName: "stock_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "stock_status", columnName: "stock_status", dataType: "STRING", nullable: true },
          { jsonPath: "manage_stock", columnName: "manage_stock", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "weight", columnName: "weight", dataType: "STRING", nullable: true },
          { jsonPath: "total_sales", columnName: "total_sales", dataType: "INTEGER", nullable: true },
          { jsonPath: "date_created", columnName: "date_created", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "date_modified", columnName: "date_modified", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "tax_status", columnName: "tax_status", dataType: "STRING", nullable: true },
          { jsonPath: "average_rating", columnName: "average_rating", dataType: "STRING", nullable: true },
          { jsonPath: "rating_count", columnName: "rating_count", dataType: "INTEGER", nullable: true },
        ],
      },
    },
    {
      slug: "customers",
      name: "Customers",
      description: "WooCommerce customer accounts",
      endpoint: "/customers",
      responseRoot: "$",
      incrementalKey: "date_modified",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "email", columnName: "email", dataType: "STRING", nullable: true },
          { jsonPath: "first_name", columnName: "first_name", dataType: "STRING", nullable: true },
          { jsonPath: "last_name", columnName: "last_name", dataType: "STRING", nullable: true },
          { jsonPath: "username", columnName: "username", dataType: "STRING", nullable: true },
          { jsonPath: "role", columnName: "role", dataType: "STRING", nullable: true },
          { jsonPath: "date_created", columnName: "date_created", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "date_modified", columnName: "date_modified", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "orders_count", columnName: "orders_count", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_spent", columnName: "total_spent", dataType: "STRING", nullable: true },
          { jsonPath: "avatar_url", columnName: "avatar_url", dataType: "STRING", nullable: true },
          { jsonPath: "billing.phone", columnName: "billing_phone", dataType: "STRING", nullable: true },
          { jsonPath: "billing.city", columnName: "billing_city", dataType: "STRING", nullable: true },
          { jsonPath: "billing.state", columnName: "billing_state", dataType: "STRING", nullable: true },
          { jsonPath: "billing.country", columnName: "billing_country", dataType: "STRING", nullable: true },
          { jsonPath: "shipping.city", columnName: "shipping_city", dataType: "STRING", nullable: true },
          { jsonPath: "shipping.state", columnName: "shipping_state", dataType: "STRING", nullable: true },
          { jsonPath: "shipping.country", columnName: "shipping_country", dataType: "STRING", nullable: true },
          { jsonPath: "is_paying_customer", columnName: "is_paying_customer", dataType: "BOOLEAN", nullable: true },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 9. ShipBob
// ───────────────────────────────────────────────────────────────────────────
const shipBob: ConnectorDef = {
  slug: "shipbob",
  name: "ShipBob",
  description: "Third-party logistics and fulfillment platform for e-commerce",
  category: "Shipping",
  docsUrl: "https://developer.shipbob.com/",
  popularity: 60,
  authType: "BEARER",
  baseUrl: "https://api.shipbob.com/1.0",
  authConfig: {
    fields: [
      { key: "bearerToken", label: "API Token", type: "password", placeholder: "Enter your ShipBob PAT", required: true },
    ],
    tokenPrefix: "Bearer",
  },
  pagination: {
    type: "cursor",
    pageParam: "Page",
    limitParam: "Limit",
    defaultLimit: 100,
  },
  objects: [
    {
      slug: "orders",
      name: "Orders",
      description: "Fulfillment orders sent to ShipBob",
      endpoint: "/order",
      responseRoot: "$",
      incrementalKey: "created_date",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "reference_id", columnName: "reference_id", dataType: "STRING", nullable: true },
          { jsonPath: "order_number", columnName: "order_number", dataType: "STRING", nullable: true },
          { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "type", columnName: "type", dataType: "STRING", nullable: true },
          { jsonPath: "created_date", columnName: "created_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "purchase_date", columnName: "purchase_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "channel.name", columnName: "channel_name", dataType: "STRING", nullable: true },
          { jsonPath: "recipient.name", columnName: "recipient_name", dataType: "STRING", nullable: true },
          { jsonPath: "recipient.email", columnName: "recipient_email", dataType: "STRING", nullable: true },
          { jsonPath: "recipient.address.city", columnName: "recipient_city", dataType: "STRING", nullable: true },
          { jsonPath: "recipient.address.state", columnName: "recipient_state", dataType: "STRING", nullable: true },
          { jsonPath: "recipient.address.country", columnName: "recipient_country", dataType: "STRING", nullable: true },
          { jsonPath: "recipient.address.zip_code", columnName: "recipient_zip", dataType: "STRING", nullable: true },
          { jsonPath: "shipping_method", columnName: "shipping_method", dataType: "STRING", nullable: true },
          { jsonPath: "shipping_terms.carrier", columnName: "carrier", dataType: "STRING", nullable: true },
          { jsonPath: "tags", columnName: "tags", dataType: "JSON", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "products",
            tableName: "orders_products",
            foreignKey: "order_id",
            columns: [
              { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
              { jsonPath: "reference_id", columnName: "reference_id", dataType: "STRING", nullable: true },
              { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
              { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: true },
              { jsonPath: "quantity", columnName: "quantity", dataType: "INTEGER", nullable: true },
              { jsonPath: "quantity_committed", columnName: "quantity_committed", dataType: "INTEGER", nullable: true },
              { jsonPath: "unit_price", columnName: "unit_price", dataType: "FLOAT", nullable: true },
            ],
          },
        ],
      },
    },
    {
      slug: "products",
      name: "Products",
      description: "Product catalog synced to ShipBob",
      endpoint: "/product",
      responseRoot: "$",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "reference_id", columnName: "reference_id", dataType: "STRING", nullable: true },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: true },
          { jsonPath: "barcode", columnName: "barcode", dataType: "STRING", nullable: true },
          { jsonPath: "gtin", columnName: "gtin", dataType: "STRING", nullable: true },
          { jsonPath: "upc", columnName: "upc", dataType: "STRING", nullable: true },
          { jsonPath: "unit_price", columnName: "unit_price", dataType: "FLOAT", nullable: true },
          { jsonPath: "created_date", columnName: "created_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "channel.name", columnName: "channel_name", dataType: "STRING", nullable: true },
          { jsonPath: "is_case_pick", columnName: "is_case_pick", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "total_fulfillable_quantity", columnName: "total_fulfillable_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_onhand_quantity", columnName: "total_onhand_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_committed_quantity", columnName: "total_committed_quantity", dataType: "INTEGER", nullable: true },
        ],
      },
    },
    {
      slug: "inventory",
      name: "Inventory",
      description: "Inventory quantities across fulfillment centers",
      endpoint: "/inventory",
      responseRoot: "$",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "is_digital", columnName: "is_digital", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "is_case_pick", columnName: "is_case_pick", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "total_fulfillable_quantity", columnName: "total_fulfillable_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_onhand_quantity", columnName: "total_onhand_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_committed_quantity", columnName: "total_committed_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_sellable_quantity", columnName: "total_sellable_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_awaiting_quantity", columnName: "total_awaiting_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_exception_quantity", columnName: "total_exception_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_internal_transfer_quantity", columnName: "total_internal_transfer_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "is_lot", columnName: "is_lot", dataType: "BOOLEAN", nullable: true },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 10. Cin7
// ───────────────────────────────────────────────────────────────────────────
const cin7: ConnectorDef = {
  slug: "cin7",
  name: "Cin7",
  description: "Inventory management and order fulfillment platform",
  category: "Inventory",
  docsUrl: "https://api.cin7.com/",
  popularity: 55,
  authType: "API_KEY",
  baseUrl: "https://api.cin7.com/api/v1",
  authConfig: {
    fields: [
      { key: "apiKey", label: "API Key", type: "password", placeholder: "Enter your Cin7 API key", required: true },
    ],
    headerName: "Authorization",
  },
  pagination: {
    type: "page_number",
    pageParam: "page",
    limitParam: "rows",
    defaultLimit: 250,
  },
  objects: [
    {
      slug: "products",
      name: "Products",
      description: "Product catalog with pricing and categories",
      endpoint: "/Products",
      responseRoot: "$",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "code", columnName: "code", dataType: "STRING", nullable: true },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "category", columnName: "category", dataType: "STRING", nullable: true },
          { jsonPath: "brand", columnName: "brand", dataType: "STRING", nullable: true },
          { jsonPath: "type", columnName: "type", dataType: "STRING", nullable: true },
          { jsonPath: "supplierName", columnName: "supplier_name", dataType: "STRING", nullable: true },
          { jsonPath: "supplierCode", columnName: "supplier_code", dataType: "STRING", nullable: true },
          { jsonPath: "barcode", columnName: "barcode", dataType: "STRING", nullable: true },
          { jsonPath: "weight", columnName: "weight", dataType: "FLOAT", nullable: true },
          { jsonPath: "wholesalePrice", columnName: "wholesale_price", dataType: "FLOAT", nullable: true },
          { jsonPath: "retailPrice", columnName: "retail_price", dataType: "FLOAT", nullable: true },
          { jsonPath: "costPrice", columnName: "cost_price", dataType: "FLOAT", nullable: true },
          { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "stockOnHand", columnName: "stock_on_hand", dataType: "FLOAT", nullable: true },
          { jsonPath: "stockAvailable", columnName: "stock_available", dataType: "FLOAT", nullable: true },
          { jsonPath: "createdDate", columnName: "created_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "modifiedDate", columnName: "modified_date", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
    {
      slug: "stock",
      name: "Stock",
      description: "Stock levels across warehouses and locations",
      endpoint: "/Stock",
      responseRoot: "$",
      schema: {
        columns: [
          { jsonPath: "productId", columnName: "product_id", dataType: "INTEGER", nullable: false },
          { jsonPath: "productCode", columnName: "product_code", dataType: "STRING", nullable: true },
          { jsonPath: "productName", columnName: "product_name", dataType: "STRING", nullable: true },
          { jsonPath: "warehouseId", columnName: "warehouse_id", dataType: "INTEGER", nullable: true },
          { jsonPath: "warehouseName", columnName: "warehouse_name", dataType: "STRING", nullable: true },
          { jsonPath: "location", columnName: "location", dataType: "STRING", nullable: true },
          { jsonPath: "available", columnName: "available", dataType: "FLOAT", nullable: true },
          { jsonPath: "onHand", columnName: "on_hand", dataType: "FLOAT", nullable: true },
          { jsonPath: "allocated", columnName: "allocated", dataType: "FLOAT", nullable: true },
          { jsonPath: "onOrder", columnName: "on_order", dataType: "FLOAT", nullable: true },
          { jsonPath: "inTransit", columnName: "in_transit", dataType: "FLOAT", nullable: true },
          { jsonPath: "stockOnHand", columnName: "stock_on_hand", dataType: "FLOAT", nullable: true },
        ],
      },
    },
    {
      slug: "sales-orders",
      name: "Sales Orders",
      description: "Customer sales orders and fulfillment status",
      endpoint: "/SalesOrders",
      responseRoot: "$",
      incrementalKey: "modifiedDate",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
          { jsonPath: "reference", columnName: "reference", dataType: "STRING", nullable: true },
          { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "createdDate", columnName: "created_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "modifiedDate", columnName: "modified_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "requiredByDate", columnName: "required_by_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "customerName", columnName: "customer_name", dataType: "STRING", nullable: true },
          { jsonPath: "customerEmail", columnName: "customer_email", dataType: "STRING", nullable: true },
          { jsonPath: "total", columnName: "total", dataType: "FLOAT", nullable: true },
          { jsonPath: "tax", columnName: "tax", dataType: "FLOAT", nullable: true },
          { jsonPath: "paid", columnName: "paid", dataType: "FLOAT", nullable: true },
          { jsonPath: "currencyCode", columnName: "currency_code", dataType: "STRING", nullable: true },
          { jsonPath: "warehouse", columnName: "warehouse", dataType: "STRING", nullable: true },
          { jsonPath: "shippingAddress.city", columnName: "shipping_city", dataType: "STRING", nullable: true },
          { jsonPath: "shippingAddress.state", columnName: "shipping_state", dataType: "STRING", nullable: true },
          { jsonPath: "shippingAddress.country", columnName: "shipping_country", dataType: "STRING", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "lineItems",
            tableName: "sales_orders_line_items",
            foreignKey: "sales_order_id",
            columns: [
              { jsonPath: "productId", columnName: "product_id", dataType: "INTEGER", nullable: true },
              { jsonPath: "productCode", columnName: "product_code", dataType: "STRING", nullable: true },
              { jsonPath: "productName", columnName: "product_name", dataType: "STRING", nullable: true },
              { jsonPath: "quantity", columnName: "quantity", dataType: "FLOAT", nullable: true },
              { jsonPath: "unitPrice", columnName: "unit_price", dataType: "FLOAT", nullable: true },
              { jsonPath: "total", columnName: "total", dataType: "FLOAT", nullable: true },
              { jsonPath: "tax", columnName: "tax", dataType: "FLOAT", nullable: true },
            ],
          },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 11. QuickBooks Online
// ───────────────────────────────────────────────────────────────────────────
const quickBooksOnline: ConnectorDef = {
  slug: "quickbooks-online",
  name: "QuickBooks Online",
  description: "Cloud accounting software by Intuit — invoices, customers, payments, and more",
  category: "Accounting",
  docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities",
  popularity: 90,
  authType: "BEARER",
  baseUrl: "https://quickbooks.api.intuit.com/v3/company/{companyId}",
  authConfig: {
    fields: [
      { key: "bearerToken", label: "Access Token", type: "password", placeholder: "OAuth2 access token", required: true },
      { key: "companyId", label: "Company ID (Realm ID)", type: "text", placeholder: "123456789", required: true },
    ],
    tokenPrefix: "Bearer",
    urlPlaceholders: ["companyId"],
  },
  pagination: {
    type: "offset",
    pageParam: "startPosition",
    limitParam: "maxResults",
    defaultLimit: 100,
  },
  rateLimiting: { requestsPerMinute: 500 },
  objects: [
    {
      slug: "invoices",
      name: "Invoices",
      description: "Sales invoices sent to customers",
      endpoint: "/query",
      method: "GET",
      responseRoot: "QueryResponse.Invoice",
      incrementalKey: "MetaData.LastUpdatedTime",
      defaultParams: { query: "SELECT * FROM Invoice ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 100" },
      schema: {
        columns: [
          { jsonPath: "Id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "DocNumber", columnName: "doc_number", dataType: "STRING", nullable: true },
          { jsonPath: "TxnDate", columnName: "txn_date", dataType: "DATE", nullable: true },
          { jsonPath: "DueDate", columnName: "due_date", dataType: "DATE", nullable: true },
          { jsonPath: "TotalAmt", columnName: "total_amount", dataType: "FLOAT", nullable: true },
          { jsonPath: "Balance", columnName: "balance", dataType: "FLOAT", nullable: true },
          { jsonPath: "CustomerRef.value", columnName: "customer_id", dataType: "STRING", nullable: true },
          { jsonPath: "CustomerRef.name", columnName: "customer_name", dataType: "STRING", nullable: true },
          { jsonPath: "BillEmail.Address", columnName: "bill_email", dataType: "STRING", nullable: true },
          { jsonPath: "CurrencyRef.value", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "EmailStatus", columnName: "email_status", dataType: "STRING", nullable: true },
          { jsonPath: "PrintStatus", columnName: "print_status", dataType: "STRING", nullable: true },
          { jsonPath: "MetaData.CreateTime", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "MetaData.LastUpdatedTime", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "Line",
            tableName: "invoice_line_items",
            foreignKey: "invoice_id",
            columns: [
              { jsonPath: "Id", columnName: "line_id", dataType: "STRING", nullable: false },
              { jsonPath: "LineNum", columnName: "line_num", dataType: "INTEGER", nullable: true },
              { jsonPath: "Description", columnName: "description", dataType: "STRING", nullable: true },
              { jsonPath: "Amount", columnName: "amount", dataType: "FLOAT", nullable: true },
              { jsonPath: "DetailType", columnName: "detail_type", dataType: "STRING", nullable: true },
              { jsonPath: "SalesItemLineDetail.ItemRef.value", columnName: "item_id", dataType: "STRING", nullable: true },
              { jsonPath: "SalesItemLineDetail.ItemRef.name", columnName: "item_name", dataType: "STRING", nullable: true },
              { jsonPath: "SalesItemLineDetail.Qty", columnName: "quantity", dataType: "FLOAT", nullable: true },
              { jsonPath: "SalesItemLineDetail.UnitPrice", columnName: "unit_price", dataType: "FLOAT", nullable: true },
            ],
          },
        ],
      },
    },
    {
      slug: "customers",
      name: "Customers",
      description: "Customer records used on invoices and sales receipts",
      endpoint: "/query",
      method: "GET",
      responseRoot: "QueryResponse.Customer",
      incrementalKey: "MetaData.LastUpdatedTime",
      defaultParams: { query: "SELECT * FROM Customer ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 100" },
      schema: {
        columns: [
          { jsonPath: "Id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "DisplayName", columnName: "display_name", dataType: "STRING", nullable: true },
          { jsonPath: "CompanyName", columnName: "company_name", dataType: "STRING", nullable: true },
          { jsonPath: "GivenName", columnName: "given_name", dataType: "STRING", nullable: true },
          { jsonPath: "FamilyName", columnName: "family_name", dataType: "STRING", nullable: true },
          { jsonPath: "PrimaryEmailAddr.Address", columnName: "email", dataType: "STRING", nullable: true },
          { jsonPath: "PrimaryPhone.FreeFormNumber", columnName: "phone", dataType: "STRING", nullable: true },
          { jsonPath: "BillAddr.Line1", columnName: "bill_address_line1", dataType: "STRING", nullable: true },
          { jsonPath: "BillAddr.City", columnName: "bill_city", dataType: "STRING", nullable: true },
          { jsonPath: "BillAddr.CountrySubDivisionCode", columnName: "bill_state", dataType: "STRING", nullable: true },
          { jsonPath: "BillAddr.PostalCode", columnName: "bill_postal_code", dataType: "STRING", nullable: true },
          { jsonPath: "Balance", columnName: "balance", dataType: "FLOAT", nullable: true },
          { jsonPath: "Active", columnName: "active", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "MetaData.CreateTime", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "MetaData.LastUpdatedTime", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
    {
      slug: "items",
      name: "Items",
      description: "Products and services available for sale or purchase",
      endpoint: "/query",
      method: "GET",
      responseRoot: "QueryResponse.Item",
      incrementalKey: "MetaData.LastUpdatedTime",
      defaultParams: { query: "SELECT * FROM Item ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 100" },
      schema: {
        columns: [
          { jsonPath: "Id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "Name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "Sku", columnName: "sku", dataType: "STRING", nullable: true },
          { jsonPath: "Type", columnName: "type", dataType: "STRING", nullable: true },
          { jsonPath: "Description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "UnitPrice", columnName: "unit_price", dataType: "FLOAT", nullable: true },
          { jsonPath: "PurchaseCost", columnName: "purchase_cost", dataType: "FLOAT", nullable: true },
          { jsonPath: "QtyOnHand", columnName: "qty_on_hand", dataType: "FLOAT", nullable: true },
          { jsonPath: "TrackQtyOnHand", columnName: "track_qty_on_hand", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "Taxable", columnName: "taxable", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "Active", columnName: "active", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "IncomeAccountRef.name", columnName: "income_account", dataType: "STRING", nullable: true },
          { jsonPath: "ExpenseAccountRef.name", columnName: "expense_account", dataType: "STRING", nullable: true },
          { jsonPath: "MetaData.CreateTime", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "MetaData.LastUpdatedTime", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
    {
      slug: "payments",
      name: "Payments",
      description: "Payments received against customer invoices",
      endpoint: "/query",
      method: "GET",
      responseRoot: "QueryResponse.Payment",
      incrementalKey: "MetaData.LastUpdatedTime",
      defaultParams: { query: "SELECT * FROM Payment ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 100" },
      schema: {
        columns: [
          { jsonPath: "Id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "TxnDate", columnName: "txn_date", dataType: "DATE", nullable: true },
          { jsonPath: "TotalAmt", columnName: "total_amount", dataType: "FLOAT", nullable: true },
          { jsonPath: "UnappliedAmt", columnName: "unapplied_amount", dataType: "FLOAT", nullable: true },
          { jsonPath: "CustomerRef.value", columnName: "customer_id", dataType: "STRING", nullable: true },
          { jsonPath: "CustomerRef.name", columnName: "customer_name", dataType: "STRING", nullable: true },
          { jsonPath: "DepositToAccountRef.value", columnName: "deposit_account_id", dataType: "STRING", nullable: true },
          { jsonPath: "PaymentMethodRef.value", columnName: "payment_method_id", dataType: "STRING", nullable: true },
          { jsonPath: "CurrencyRef.value", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "ProcessPayment", columnName: "process_payment", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "MetaData.CreateTime", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "MetaData.LastUpdatedTime", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
    {
      slug: "bills",
      name: "Bills",
      description: "Bills from vendors (accounts payable)",
      endpoint: "/query",
      method: "GET",
      responseRoot: "QueryResponse.Bill",
      incrementalKey: "MetaData.LastUpdatedTime",
      defaultParams: { query: "SELECT * FROM Bill ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 100" },
      schema: {
        columns: [
          { jsonPath: "Id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "DocNumber", columnName: "doc_number", dataType: "STRING", nullable: true },
          { jsonPath: "TxnDate", columnName: "txn_date", dataType: "DATE", nullable: true },
          { jsonPath: "DueDate", columnName: "due_date", dataType: "DATE", nullable: true },
          { jsonPath: "TotalAmt", columnName: "total_amount", dataType: "FLOAT", nullable: true },
          { jsonPath: "Balance", columnName: "balance", dataType: "FLOAT", nullable: true },
          { jsonPath: "VendorRef.value", columnName: "vendor_id", dataType: "STRING", nullable: true },
          { jsonPath: "VendorRef.name", columnName: "vendor_name", dataType: "STRING", nullable: true },
          { jsonPath: "APAccountRef.value", columnName: "ap_account_id", dataType: "STRING", nullable: true },
          { jsonPath: "APAccountRef.name", columnName: "ap_account_name", dataType: "STRING", nullable: true },
          { jsonPath: "CurrencyRef.value", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "MetaData.CreateTime", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "MetaData.LastUpdatedTime", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "Line",
            tableName: "bill_line_items",
            foreignKey: "bill_id",
            columns: [
              { jsonPath: "Id", columnName: "line_id", dataType: "STRING", nullable: false },
              { jsonPath: "LineNum", columnName: "line_num", dataType: "INTEGER", nullable: true },
              { jsonPath: "Description", columnName: "description", dataType: "STRING", nullable: true },
              { jsonPath: "Amount", columnName: "amount", dataType: "FLOAT", nullable: true },
              { jsonPath: "DetailType", columnName: "detail_type", dataType: "STRING", nullable: true },
              { jsonPath: "AccountBasedExpenseLineDetail.AccountRef.value", columnName: "account_id", dataType: "STRING", nullable: true },
              { jsonPath: "AccountBasedExpenseLineDetail.AccountRef.name", columnName: "account_name", dataType: "STRING", nullable: true },
            ],
          },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 12. Square
// ───────────────────────────────────────────────────────────────────────────
const square: ConnectorDef = {
  slug: "square",
  name: "Square",
  description: "POS and payment processing platform for in-person and online commerce",
  category: "Payments",
  docsUrl: "https://developer.squareup.com/reference/square",
  popularity: 82,
  authType: "BEARER",
  baseUrl: "https://connect.squareup.com/v2",
  authConfig: {
    fields: [
      { key: "bearerToken", label: "Access Token", type: "password", placeholder: "sq0atp-xxxxx", required: true },
    ],
    tokenPrefix: "Bearer",
  },
  pagination: {
    type: "cursor",
    cursorPath: "cursor",
    nextParam: "cursor",
    limitParam: "limit",
    defaultLimit: 100,
  },
  rateLimiting: { requestsPerSecond: 10 },
  objects: [
    {
      slug: "payments",
      name: "Payments",
      description: "Completed payment transactions",
      endpoint: "/payments",
      responseRoot: "payments",
      incrementalKey: "updated_at",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updated_at", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "amount_money.amount", columnName: "amount", dataType: "INTEGER", nullable: true },
          { jsonPath: "amount_money.currency", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "tip_money.amount", columnName: "tip_amount", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_money.amount", columnName: "total_amount", dataType: "INTEGER", nullable: true },
          { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "source_type", columnName: "source_type", dataType: "STRING", nullable: true },
          { jsonPath: "location_id", columnName: "location_id", dataType: "STRING", nullable: true },
          { jsonPath: "order_id", columnName: "order_id", dataType: "STRING", nullable: true },
          { jsonPath: "customer_id", columnName: "customer_id", dataType: "STRING", nullable: true },
          { jsonPath: "receipt_number", columnName: "receipt_number", dataType: "STRING", nullable: true },
          { jsonPath: "receipt_url", columnName: "receipt_url", dataType: "STRING", nullable: true },
        ],
      },
    },
    {
      slug: "orders",
      name: "Orders",
      description: "Orders including itemized line items, discounts, and taxes",
      endpoint: "/orders/search",
      method: "POST",
      responseRoot: "orders",
      incrementalKey: "updated_at",
      defaultParams: { query: { sort: { sort_field: "UPDATED_AT", sort_order: "DESC" } } },
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "location_id", columnName: "location_id", dataType: "STRING", nullable: true },
          { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updated_at", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "state", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "total_money.amount", columnName: "total_amount", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_money.currency", columnName: "currency", dataType: "STRING", nullable: true },
          { jsonPath: "total_tax_money.amount", columnName: "total_tax", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_discount_money.amount", columnName: "total_discount", dataType: "INTEGER", nullable: true },
          { jsonPath: "total_tip_money.amount", columnName: "total_tip", dataType: "INTEGER", nullable: true },
          { jsonPath: "source.name", columnName: "source_name", dataType: "STRING", nullable: true },
          { jsonPath: "customer_id", columnName: "customer_id", dataType: "STRING", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "line_items",
            tableName: "order_line_items",
            foreignKey: "order_id",
            columns: [
              { jsonPath: "uid", columnName: "uid", dataType: "STRING", nullable: false },
              { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
              { jsonPath: "quantity", columnName: "quantity", dataType: "STRING", nullable: true },
              { jsonPath: "catalog_object_id", columnName: "catalog_object_id", dataType: "STRING", nullable: true },
              { jsonPath: "base_price_money.amount", columnName: "base_price", dataType: "INTEGER", nullable: true },
              { jsonPath: "total_money.amount", columnName: "total_amount", dataType: "INTEGER", nullable: true },
              { jsonPath: "total_tax_money.amount", columnName: "total_tax", dataType: "INTEGER", nullable: true },
              { jsonPath: "total_discount_money.amount", columnName: "total_discount", dataType: "INTEGER", nullable: true },
            ],
          },
        ],
      },
    },
    {
      slug: "customers",
      name: "Customers",
      description: "Customer directory entries",
      endpoint: "/customers",
      responseRoot: "customers",
      incrementalKey: "updated_at",
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "updated_at", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "given_name", columnName: "given_name", dataType: "STRING", nullable: true },
          { jsonPath: "family_name", columnName: "family_name", dataType: "STRING", nullable: true },
          { jsonPath: "company_name", columnName: "company_name", dataType: "STRING", nullable: true },
          { jsonPath: "email_address", columnName: "email", dataType: "STRING", nullable: true },
          { jsonPath: "phone_number", columnName: "phone", dataType: "STRING", nullable: true },
          { jsonPath: "address.address_line_1", columnName: "address_line_1", dataType: "STRING", nullable: true },
          { jsonPath: "address.locality", columnName: "city", dataType: "STRING", nullable: true },
          { jsonPath: "address.administrative_district_level_1", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "address.postal_code", columnName: "postal_code", dataType: "STRING", nullable: true },
          { jsonPath: "address.country", columnName: "country", dataType: "STRING", nullable: true },
          { jsonPath: "reference_id", columnName: "reference_id", dataType: "STRING", nullable: true },
        ],
      },
    },
    {
      slug: "catalog-items",
      name: "Catalog Items",
      description: "Product catalog objects (items, categories, discounts, taxes)",
      endpoint: "/catalog/list",
      responseRoot: "objects",
      incrementalKey: "updated_at",
      defaultParams: { types: "ITEM" },
      schema: {
        columns: [
          { jsonPath: "id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "type", columnName: "type", dataType: "STRING", nullable: true },
          { jsonPath: "updated_at", columnName: "updated_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "is_deleted", columnName: "is_deleted", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "item_data.name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "item_data.description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "item_data.category_id", columnName: "category_id", dataType: "STRING", nullable: true },
          { jsonPath: "item_data.product_type", columnName: "product_type", dataType: "STRING", nullable: true },
          { jsonPath: "item_data.is_taxable", columnName: "is_taxable", dataType: "BOOLEAN", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "item_data.variations",
            tableName: "catalog_item_variations",
            foreignKey: "catalog_item_id",
            columns: [
              { jsonPath: "id", columnName: "variation_id", dataType: "STRING", nullable: false },
              { jsonPath: "item_variation_data.name", columnName: "name", dataType: "STRING", nullable: true },
              { jsonPath: "item_variation_data.sku", columnName: "sku", dataType: "STRING", nullable: true },
              { jsonPath: "item_variation_data.price_money.amount", columnName: "price", dataType: "INTEGER", nullable: true },
              { jsonPath: "item_variation_data.price_money.currency", columnName: "currency", dataType: "STRING", nullable: true },
              { jsonPath: "item_variation_data.track_inventory", columnName: "track_inventory", dataType: "BOOLEAN", nullable: true },
            ],
          },
        ],
      },
    },
    {
      slug: "inventory",
      name: "Inventory Counts",
      description: "Current inventory counts per variation per location",
      endpoint: "/inventory/counts/batch-retrieve",
      method: "POST",
      responseRoot: "counts",
      incrementalKey: "calculated_at",
      schema: {
        columns: [
          { jsonPath: "catalog_object_id", columnName: "catalog_object_id", dataType: "STRING", nullable: false },
          { jsonPath: "catalog_object_type", columnName: "catalog_object_type", dataType: "STRING", nullable: true },
          { jsonPath: "location_id", columnName: "location_id", dataType: "STRING", nullable: true },
          { jsonPath: "quantity", columnName: "quantity", dataType: "STRING", nullable: true },
          { jsonPath: "state", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "calculated_at", columnName: "calculated_at", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 13. Google Sheets
// ───────────────────────────────────────────────────────────────────────────
const googleSheets: ConnectorDef = {
  slug: "google-sheets",
  name: "Google Sheets",
  description: "Use Google Sheets spreadsheets as a data source via the Sheets API v4",
  category: "Productivity",
  docsUrl: "https://developers.google.com/sheets/api/reference/rest",
  popularity: 80,
  authType: "BEARER",
  baseUrl: "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}",
  authConfig: {
    fields: [
      { key: "bearerToken", label: "Access Token", type: "password", placeholder: "OAuth2 access token", required: true },
      { key: "spreadsheetId", label: "Spreadsheet ID", type: "text", placeholder: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", required: true },
    ],
    tokenPrefix: "Bearer",
    urlPlaceholders: ["spreadsheetId"],
  },
  pagination: {
    type: "none",
  },
  objects: [
    {
      slug: "sheet-metadata",
      name: "Spreadsheet Metadata",
      description: "Spreadsheet properties including title, locale, and sheet tab info",
      endpoint: "",
      responseRoot: "$",
      defaultParams: { fields: "spreadsheetId,properties,sheets.properties" },
      schema: {
        columns: [
          { jsonPath: "spreadsheetId", columnName: "spreadsheet_id", dataType: "STRING", nullable: false },
          { jsonPath: "properties.title", columnName: "title", dataType: "STRING", nullable: true },
          { jsonPath: "properties.locale", columnName: "locale", dataType: "STRING", nullable: true },
          { jsonPath: "properties.autoRecalc", columnName: "auto_recalc", dataType: "STRING", nullable: true },
          { jsonPath: "properties.timeZone", columnName: "time_zone", dataType: "STRING", nullable: true },
          { jsonPath: "properties.defaultFormat.backgroundColor", columnName: "default_bg_color", dataType: "JSON", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "sheets",
            tableName: "sheet_tabs",
            foreignKey: "spreadsheet_id",
            columns: [
              { jsonPath: "properties.sheetId", columnName: "sheet_id", dataType: "INTEGER", nullable: false },
              { jsonPath: "properties.title", columnName: "title", dataType: "STRING", nullable: true },
              { jsonPath: "properties.index", columnName: "tab_index", dataType: "INTEGER", nullable: true },
              { jsonPath: "properties.sheetType", columnName: "sheet_type", dataType: "STRING", nullable: true },
              { jsonPath: "properties.gridProperties.rowCount", columnName: "row_count", dataType: "INTEGER", nullable: true },
              { jsonPath: "properties.gridProperties.columnCount", columnName: "column_count", dataType: "INTEGER", nullable: true },
              { jsonPath: "properties.hidden", columnName: "hidden", dataType: "BOOLEAN", nullable: true },
            ],
          },
        ],
      },
    },
    {
      slug: "values",
      name: "Sheet Values",
      description: "Cell values from a specific sheet range (defaults to entire first sheet)",
      endpoint: "/values/{range}",
      responseRoot: "values",
      defaultParams: { range: "Sheet1", valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" },
      schema: {
        columns: [
          { jsonPath: "range", columnName: "range", dataType: "STRING", nullable: true },
          { jsonPath: "majorDimension", columnName: "major_dimension", dataType: "STRING", nullable: true },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 14. ServiceNow
// ───────────────────────────────────────────────────────────────────────────
const serviceNow: ConnectorDef = {
  slug: "servicenow",
  name: "ServiceNow",
  description: "Enterprise IT service management platform — incidents, changes, CMDB, and more",
  category: "ITSM",
  docsUrl: "https://developer.servicenow.com/dev.do#!/reference/api/latest/rest/c_TableAPI",
  popularity: 85,
  authType: "BASIC",
  baseUrl: "https://{instance}.service-now.com/api/now",
  authConfig: {
    fields: [
      { key: "username", label: "Username", type: "text", placeholder: "admin", required: true },
      { key: "password", label: "Password", type: "password", placeholder: "ServiceNow password", required: true },
      { key: "instance", label: "Instance Name", type: "text", placeholder: "mycompany", required: true },
    ],
    urlPlaceholders: ["instance"],
  },
  pagination: {
    type: "offset",
    pageParam: "sysparm_offset",
    limitParam: "sysparm_limit",
    defaultLimit: 100,
  },
  rateLimiting: { requestsPerMinute: 60 },
  objects: [
    {
      slug: "incidents",
      name: "Incidents",
      description: "IT incident records",
      endpoint: "/table/incident",
      responseRoot: "result",
      incrementalKey: "sys_updated_on",
      defaultParams: { sysparm_display_value: "true", sysparm_exclude_reference_link: "true" },
      schema: {
        columns: [
          { jsonPath: "sys_id", columnName: "sys_id", dataType: "STRING", nullable: false },
          { jsonPath: "number", columnName: "number", dataType: "STRING", nullable: true },
          { jsonPath: "short_description", columnName: "short_description", dataType: "STRING", nullable: true },
          { jsonPath: "description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "state", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "impact", columnName: "impact", dataType: "STRING", nullable: true },
          { jsonPath: "urgency", columnName: "urgency", dataType: "STRING", nullable: true },
          { jsonPath: "priority", columnName: "priority", dataType: "STRING", nullable: true },
          { jsonPath: "category", columnName: "category", dataType: "STRING", nullable: true },
          { jsonPath: "subcategory", columnName: "subcategory", dataType: "STRING", nullable: true },
          { jsonPath: "assignment_group", columnName: "assignment_group", dataType: "STRING", nullable: true },
          { jsonPath: "assigned_to", columnName: "assigned_to", dataType: "STRING", nullable: true },
          { jsonPath: "caller_id", columnName: "caller_id", dataType: "STRING", nullable: true },
          { jsonPath: "opened_by", columnName: "opened_by", dataType: "STRING", nullable: true },
          { jsonPath: "opened_at", columnName: "opened_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "resolved_at", columnName: "resolved_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "closed_at", columnName: "closed_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "close_code", columnName: "close_code", dataType: "STRING", nullable: true },
          { jsonPath: "sys_created_on", columnName: "sys_created_on", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "sys_updated_on", columnName: "sys_updated_on", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
    {
      slug: "changes",
      name: "Change Requests",
      description: "IT change management records",
      endpoint: "/table/change_request",
      responseRoot: "result",
      incrementalKey: "sys_updated_on",
      defaultParams: { sysparm_display_value: "true", sysparm_exclude_reference_link: "true" },
      schema: {
        columns: [
          { jsonPath: "sys_id", columnName: "sys_id", dataType: "STRING", nullable: false },
          { jsonPath: "number", columnName: "number", dataType: "STRING", nullable: true },
          { jsonPath: "short_description", columnName: "short_description", dataType: "STRING", nullable: true },
          { jsonPath: "description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "type", columnName: "type", dataType: "STRING", nullable: true },
          { jsonPath: "state", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "risk", columnName: "risk", dataType: "STRING", nullable: true },
          { jsonPath: "impact", columnName: "impact", dataType: "STRING", nullable: true },
          { jsonPath: "priority", columnName: "priority", dataType: "STRING", nullable: true },
          { jsonPath: "category", columnName: "category", dataType: "STRING", nullable: true },
          { jsonPath: "assignment_group", columnName: "assignment_group", dataType: "STRING", nullable: true },
          { jsonPath: "assigned_to", columnName: "assigned_to", dataType: "STRING", nullable: true },
          { jsonPath: "requested_by", columnName: "requested_by", dataType: "STRING", nullable: true },
          { jsonPath: "start_date", columnName: "start_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "end_date", columnName: "end_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "cab_required", columnName: "cab_required", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "sys_created_on", columnName: "sys_created_on", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "sys_updated_on", columnName: "sys_updated_on", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
    {
      slug: "problems",
      name: "Problems",
      description: "Problem management records for root cause analysis",
      endpoint: "/table/problem",
      responseRoot: "result",
      incrementalKey: "sys_updated_on",
      defaultParams: { sysparm_display_value: "true", sysparm_exclude_reference_link: "true" },
      schema: {
        columns: [
          { jsonPath: "sys_id", columnName: "sys_id", dataType: "STRING", nullable: false },
          { jsonPath: "number", columnName: "number", dataType: "STRING", nullable: true },
          { jsonPath: "short_description", columnName: "short_description", dataType: "STRING", nullable: true },
          { jsonPath: "description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "state", columnName: "state", dataType: "STRING", nullable: true },
          { jsonPath: "impact", columnName: "impact", dataType: "STRING", nullable: true },
          { jsonPath: "urgency", columnName: "urgency", dataType: "STRING", nullable: true },
          { jsonPath: "priority", columnName: "priority", dataType: "STRING", nullable: true },
          { jsonPath: "category", columnName: "category", dataType: "STRING", nullable: true },
          { jsonPath: "assignment_group", columnName: "assignment_group", dataType: "STRING", nullable: true },
          { jsonPath: "assigned_to", columnName: "assigned_to", dataType: "STRING", nullable: true },
          { jsonPath: "opened_at", columnName: "opened_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "resolved_at", columnName: "resolved_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "closed_at", columnName: "closed_at", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "known_error", columnName: "known_error", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "sys_created_on", columnName: "sys_created_on", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "sys_updated_on", columnName: "sys_updated_on", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
    {
      slug: "users",
      name: "Users",
      description: "ServiceNow user accounts",
      endpoint: "/table/sys_user",
      responseRoot: "result",
      incrementalKey: "sys_updated_on",
      defaultParams: { sysparm_display_value: "true", sysparm_exclude_reference_link: "true" },
      schema: {
        columns: [
          { jsonPath: "sys_id", columnName: "sys_id", dataType: "STRING", nullable: false },
          { jsonPath: "user_name", columnName: "user_name", dataType: "STRING", nullable: true },
          { jsonPath: "first_name", columnName: "first_name", dataType: "STRING", nullable: true },
          { jsonPath: "last_name", columnName: "last_name", dataType: "STRING", nullable: true },
          { jsonPath: "email", columnName: "email", dataType: "STRING", nullable: true },
          { jsonPath: "phone", columnName: "phone", dataType: "STRING", nullable: true },
          { jsonPath: "mobile_phone", columnName: "mobile_phone", dataType: "STRING", nullable: true },
          { jsonPath: "title", columnName: "title", dataType: "STRING", nullable: true },
          { jsonPath: "department", columnName: "department", dataType: "STRING", nullable: true },
          { jsonPath: "company", columnName: "company", dataType: "STRING", nullable: true },
          { jsonPath: "location", columnName: "location", dataType: "STRING", nullable: true },
          { jsonPath: "manager", columnName: "manager", dataType: "STRING", nullable: true },
          { jsonPath: "active", columnName: "active", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "locked_out", columnName: "locked_out", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "sys_created_on", columnName: "sys_created_on", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "sys_updated_on", columnName: "sys_updated_on", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
    {
      slug: "cmdb-ci",
      name: "Configuration Items",
      description: "CMDB configuration items (servers, applications, network devices, etc.)",
      endpoint: "/table/cmdb_ci",
      responseRoot: "result",
      incrementalKey: "sys_updated_on",
      defaultParams: { sysparm_display_value: "true", sysparm_exclude_reference_link: "true" },
      schema: {
        columns: [
          { jsonPath: "sys_id", columnName: "sys_id", dataType: "STRING", nullable: false },
          { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: true },
          { jsonPath: "sys_class_name", columnName: "ci_class", dataType: "STRING", nullable: true },
          { jsonPath: "category", columnName: "category", dataType: "STRING", nullable: true },
          { jsonPath: "subcategory", columnName: "subcategory", dataType: "STRING", nullable: true },
          { jsonPath: "operational_status", columnName: "operational_status", dataType: "STRING", nullable: true },
          { jsonPath: "install_status", columnName: "install_status", dataType: "STRING", nullable: true },
          { jsonPath: "serial_number", columnName: "serial_number", dataType: "STRING", nullable: true },
          { jsonPath: "asset_tag", columnName: "asset_tag", dataType: "STRING", nullable: true },
          { jsonPath: "ip_address", columnName: "ip_address", dataType: "STRING", nullable: true },
          { jsonPath: "mac_address", columnName: "mac_address", dataType: "STRING", nullable: true },
          { jsonPath: "manufacturer", columnName: "manufacturer", dataType: "STRING", nullable: true },
          { jsonPath: "model_id", columnName: "model_id", dataType: "STRING", nullable: true },
          { jsonPath: "location", columnName: "location", dataType: "STRING", nullable: true },
          { jsonPath: "department", columnName: "department", dataType: "STRING", nullable: true },
          { jsonPath: "assigned_to", columnName: "assigned_to", dataType: "STRING", nullable: true },
          { jsonPath: "supported_by", columnName: "supported_by", dataType: "STRING", nullable: true },
          { jsonPath: "sys_created_on", columnName: "sys_created_on", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "sys_updated_on", columnName: "sys_updated_on", dataType: "TIMESTAMP", nullable: true },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// 15. SkuVault
// ───────────────────────────────────────────────────────────────────────────
const skuVault: ConnectorDef = {
  slug: "skuvault",
  name: "SkuVault",
  description: "Cloud-based inventory and warehouse management — products, sales, kits, and locations",
  category: "Inventory",
  subcategory: "Warehouse Management",
  docsUrl: "https://dev.skuvault.com/",
  popularity: 65,
  authType: "CUSTOM",
  baseUrl: "https://app.skuvault.com/api",
  authConfig: {
    fields: [
      { key: "tenantToken", label: "Tenant Token", type: "password" as const, placeholder: "Your SkuVault Tenant Token", required: true },
      { key: "userToken", label: "User Token", type: "password" as const, placeholder: "Your SkuVault User Token", required: true },
    ],
    bodyAuth: true,
    bodyTokenMap: {
      TenantToken: "tenantToken",
      UserToken: "userToken",
    },
  },
  pagination: {
    type: "page_number",
    pageParam: "PageNumber",
    limitParam: "PageSize",
    defaultLimit: 10000,
    requestMethod: "POST",
    startPage: 0,
  },
  rateLimiting: { requestsPerWindow: 10, windowSeconds: 10 },
  objects: [
    // ── Products ─────────────────────────────────────────────────────────
    {
      slug: "products",
      name: "Products",
      description: "Product catalog with SKUs, pricing, quantities, and supplier info",
      endpoint: "/products/getProducts",
      method: "POST",
      responseRoot: "Products",
      incrementalKey: "ModifiedDateUtc",
      schema: {
        columns: [
          { jsonPath: "Id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "Sku", columnName: "sku", dataType: "STRING", nullable: false },
          { jsonPath: "PrimarySku", columnName: "primary_sku", dataType: "STRING", nullable: true },
          { jsonPath: "Code", columnName: "code", dataType: "STRING", nullable: true },
          { jsonPath: "PartNumber", columnName: "part_number", dataType: "STRING", nullable: true },
          { jsonPath: "Description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "ShortDescription", columnName: "short_description", dataType: "STRING", nullable: true },
          { jsonPath: "LongDescription", columnName: "long_description", dataType: "STRING", nullable: true },
          { jsonPath: "Cost", columnName: "cost", dataType: "FLOAT", nullable: true },
          { jsonPath: "RetailPrice", columnName: "retail_price", dataType: "FLOAT", nullable: true },
          { jsonPath: "SalePrice", columnName: "sale_price", dataType: "FLOAT", nullable: true },
          { jsonPath: "WeightValue", columnName: "weight_value", dataType: "STRING", nullable: true },
          { jsonPath: "WeightUnit", columnName: "weight_unit", dataType: "STRING", nullable: true },
          { jsonPath: "ReorderPoint", columnName: "reorder_point", dataType: "INTEGER", nullable: true },
          { jsonPath: "Brand", columnName: "brand", dataType: "STRING", nullable: true },
          { jsonPath: "Supplier", columnName: "supplier", dataType: "STRING", nullable: true },
          { jsonPath: "Classification", columnName: "classification", dataType: "STRING", nullable: true },
          { jsonPath: "QuantityOnHand", columnName: "quantity_on_hand", dataType: "INTEGER", nullable: true },
          { jsonPath: "QuantityOnHold", columnName: "quantity_on_hold", dataType: "INTEGER", nullable: true },
          { jsonPath: "QuantityPicked", columnName: "quantity_picked", dataType: "INTEGER", nullable: true },
          { jsonPath: "QuantityPending", columnName: "quantity_pending", dataType: "INTEGER", nullable: true },
          { jsonPath: "QuantityAvailable", columnName: "quantity_available", dataType: "INTEGER", nullable: true },
          { jsonPath: "QuantityIncoming", columnName: "quantity_incoming", dataType: "INTEGER", nullable: true },
          { jsonPath: "QuantityInbound", columnName: "quantity_inbound", dataType: "INTEGER", nullable: true },
          { jsonPath: "QuantityTransfer", columnName: "quantity_transfer", dataType: "INTEGER", nullable: true },
          { jsonPath: "QuantityInStock", columnName: "quantity_in_stock", dataType: "INTEGER", nullable: true },
          { jsonPath: "QuantityTotalFBA", columnName: "quantity_total_fba", dataType: "INTEGER", nullable: true },
          { jsonPath: "VariationParentSku", columnName: "variation_parent_sku", dataType: "STRING", nullable: true },
          { jsonPath: "IsAlternateSKU", columnName: "is_alternate_sku", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "MOQ", columnName: "moq", dataType: "INTEGER", nullable: true },
          { jsonPath: "IncrementalQuantity", columnName: "incremental_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "DisableQuantitySync", columnName: "disable_quantity_sync", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "IsSerialized", columnName: "is_serialized", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "Client", columnName: "client", dataType: "STRING", nullable: true },
          { jsonPath: "CanBeUsedForLots", columnName: "can_be_used_for_lots", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "Statuses", columnName: "statuses", dataType: "JSON", nullable: true },
          { jsonPath: "Pictures", columnName: "pictures", dataType: "JSON", nullable: true },
          { jsonPath: "Attributes", columnName: "attributes", dataType: "JSON", nullable: true },
          { jsonPath: "CreatedDateUtc", columnName: "created_date_utc", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "ModifiedDateUtc", columnName: "modified_date_utc", dataType: "TIMESTAMP", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "SupplierInfo",
            tableName: "products_supplier_info",
            foreignKey: "product_sku",
            columns: [
              { jsonPath: "SupplierName", columnName: "supplier_name", dataType: "STRING", nullable: true },
              { jsonPath: "SupplierPartNumber", columnName: "supplier_part_number", dataType: "STRING", nullable: true },
              { jsonPath: "Cost", columnName: "cost", dataType: "FLOAT", nullable: true },
              { jsonPath: "LeadTime", columnName: "lead_time", dataType: "INTEGER", nullable: true },
              { jsonPath: "IsActive", columnName: "is_active", dataType: "BOOLEAN", nullable: true },
              { jsonPath: "IsPrimary", columnName: "is_primary", dataType: "BOOLEAN", nullable: true },
            ],
          },
        ],
      },
    },
    // ── Sales ────────────────────────────────────────────────────────────
    {
      slug: "sales",
      name: "Sales",
      description: "Sales orders from all channels with line items, shipping, and contact info",
      endpoint: "/sales/getSales",
      method: "POST",
      responseRoot: "Sales",
      incrementalKey: "SaleDate",
      defaultParams: {
        FromDate: "2020-01-01T00:00:00Z",
        ToDate: "2099-12-31T23:59:59Z",
      },
      schema: {
        columns: [
          { jsonPath: "Id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "SellerSaleId", columnName: "seller_sale_id", dataType: "STRING", nullable: true },
          { jsonPath: "MarketplaceId", columnName: "marketplace_id", dataType: "STRING", nullable: true },
          { jsonPath: "ChannelId", columnName: "channel_id", dataType: "STRING", nullable: true },
          { jsonPath: "Status", columnName: "status", dataType: "STRING", nullable: true },
          { jsonPath: "SaleDate", columnName: "sale_date", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "Marketplace", columnName: "marketplace", dataType: "STRING", nullable: true },
          { jsonPath: "ShippingCost.a", columnName: "shipping_cost", dataType: "FLOAT", nullable: true },
          { jsonPath: "ShippingCost.s", columnName: "shipping_cost_currency", dataType: "STRING", nullable: true },
          { jsonPath: "ShippingCharge.a", columnName: "shipping_charge", dataType: "FLOAT", nullable: true },
          { jsonPath: "ShippingCharge.s", columnName: "shipping_charge_currency", dataType: "STRING", nullable: true },
          { jsonPath: "ShippingInfo.City", columnName: "shipping_city", dataType: "STRING", nullable: true },
          { jsonPath: "ShippingInfo.Region", columnName: "shipping_region", dataType: "STRING", nullable: true },
          { jsonPath: "ShippingInfo.Country", columnName: "shipping_country", dataType: "STRING", nullable: true },
          { jsonPath: "ShippingInfo.PostalCode", columnName: "shipping_postal_code", dataType: "STRING", nullable: true },
          { jsonPath: "ShippingInfo.Address1", columnName: "shipping_address1", dataType: "STRING", nullable: true },
          { jsonPath: "ShippingInfo.Address2", columnName: "shipping_address2", dataType: "STRING", nullable: true },
          { jsonPath: "ContactInfo.FirstName", columnName: "contact_first_name", dataType: "STRING", nullable: true },
          { jsonPath: "ContactInfo.LastName", columnName: "contact_last_name", dataType: "STRING", nullable: true },
          { jsonPath: "ContactInfo.Company", columnName: "contact_company", dataType: "STRING", nullable: true },
          { jsonPath: "ContactInfo.Phone", columnName: "contact_phone", dataType: "STRING", nullable: true },
          { jsonPath: "ContactInfo.Email", columnName: "contact_email", dataType: "STRING", nullable: true },
          { jsonPath: "ShippingCarrier", columnName: "shipping_carrier", dataType: "STRING", nullable: true },
          { jsonPath: "ShippingClass", columnName: "shipping_class", dataType: "STRING", nullable: true },
          { jsonPath: "Notes", columnName: "notes", dataType: "STRING", nullable: true },
          { jsonPath: "PrintedStatus", columnName: "printed_status", dataType: "BOOLEAN", nullable: true },
          { jsonPath: "Charges", columnName: "charges", dataType: "JSON", nullable: true },
          { jsonPath: "Promotions", columnName: "promotions", dataType: "JSON", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "SaleItems",
            tableName: "sales_line_items",
            foreignKey: "sale_id",
            columns: [
              { jsonPath: "Sku", columnName: "sku", dataType: "STRING", nullable: true },
              { jsonPath: "Quantity", columnName: "quantity", dataType: "INTEGER", nullable: true },
              { jsonPath: "UnitPrice.a", columnName: "unit_price", dataType: "FLOAT", nullable: true },
              { jsonPath: "UnitPrice.s", columnName: "unit_price_currency", dataType: "STRING", nullable: true },
              { jsonPath: "Taxes", columnName: "taxes", dataType: "FLOAT", nullable: true },
              { jsonPath: "Promotions", columnName: "promotions", dataType: "JSON", nullable: true },
            ],
          },
          {
            jsonPath: "FulfilledItems",
            tableName: "sales_fulfilled_items",
            foreignKey: "sale_id",
            columns: [
              { jsonPath: "Sku", columnName: "sku", dataType: "STRING", nullable: true },
              { jsonPath: "Quantity", columnName: "quantity", dataType: "INTEGER", nullable: true },
            ],
          },
        ],
      },
    },
    // ── Kits ─────────────────────────────────────────────────────────────
    {
      slug: "kits",
      name: "Kits",
      description: "Product kits (bundles) with component items and quantities",
      endpoint: "/products/getKits",
      method: "POST",
      responseRoot: "Kits",
      incrementalKey: "LastModifiedDateTimeUtc",
      schema: {
        columns: [
          { jsonPath: "SKU", columnName: "sku", dataType: "STRING", nullable: false },
          { jsonPath: "Code", columnName: "code", dataType: "STRING", nullable: true },
          { jsonPath: "Cost", columnName: "cost", dataType: "FLOAT", nullable: true },
          { jsonPath: "Description", columnName: "description", dataType: "STRING", nullable: true },
          { jsonPath: "LastModifiedDateTimeUtc", columnName: "last_modified_date_utc", dataType: "TIMESTAMP", nullable: true },
          { jsonPath: "AvailableQuantity", columnName: "available_quantity", dataType: "INTEGER", nullable: true },
          { jsonPath: "AvailableQuantityLastModifiedDateTimeUtc", columnName: "available_qty_last_modified_utc", dataType: "STRING", nullable: true },
          { jsonPath: "Statuses", columnName: "statuses", dataType: "JSON", nullable: true },
        ],
        childTables: [
          {
            jsonPath: "KitLines",
            tableName: "kits_lines",
            foreignKey: "kit_sku",
            columns: [
              { jsonPath: "LineName", columnName: "line_name", dataType: "STRING", nullable: true },
              { jsonPath: "Combine", columnName: "combine", dataType: "INTEGER", nullable: true },
              { jsonPath: "Quantity", columnName: "quantity", dataType: "INTEGER", nullable: true },
              { jsonPath: "Items", columnName: "items", dataType: "JSON", nullable: true },
            ],
          },
        ],
      },
    },
    // ── Warehouses ───────────────────────────────────────────────────────
    {
      slug: "warehouses",
      name: "Warehouses",
      description: "Warehouse definitions with IDs and codes",
      endpoint: "/warehouses/getWarehouses",
      method: "POST",
      responseRoot: "Warehouses",
      schema: {
        columns: [
          { jsonPath: "Id", columnName: "id", dataType: "STRING", nullable: false },
          { jsonPath: "Code", columnName: "code", dataType: "STRING", nullable: true },
        ],
      },
    },
    // ── Locations ────────────────────────────────────────────────────────
    {
      slug: "locations",
      name: "Locations",
      description: "Warehouse locations (bins/shelves) with total quantities",
      endpoint: "/warehouses/getLocations",
      method: "POST",
      responseRoot: "Items",
      schema: {
        columns: [
          { jsonPath: "WarehouseCode", columnName: "warehouse_code", dataType: "STRING", nullable: true },
          { jsonPath: "WarehouseName", columnName: "warehouse_name", dataType: "STRING", nullable: true },
          { jsonPath: "LocationCode", columnName: "location_code", dataType: "STRING", nullable: false },
          { jsonPath: "ContainerCode", columnName: "container_code", dataType: "STRING", nullable: true },
          { jsonPath: "ParentLocation", columnName: "parent_location", dataType: "STRING", nullable: true },
          { jsonPath: "TotalQuantity", columnName: "total_quantity", dataType: "INTEGER", nullable: true },
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// All connectors
// ───────────────────────────────────────────────────────────────────────────
const ALL_CONNECTORS: ConnectorDef[] = [
  shipStation,
  shopify,
  stripe,
  hubspot,
  airtable,
  mondayCom,
  jira,
  wooCommerce,
  shipBob,
  cin7,
  quickBooksOnline,
  square,
  googleSheets,
  serviceNow,
  skuVault,
];

// ───────────────────────────────────────────────────────────────────────────
// Seed function
// ───────────────────────────────────────────────────────────────────────────
export async function seedApiCatalog(prisma: PrismaClient) {
  console.log(`Seeding ${ALL_CONNECTORS.length} API catalog connectors...`);

  for (const def of ALL_CONNECTORS) {
    // Upsert the connector (idempotent)
    const connector = await prisma.apiCatalogConnector.upsert({
      where: { slug: def.slug },
      update: {
        name: def.name,
        description: def.description,
        category: def.category,
        subcategory: def.subcategory ?? null,
        docsUrl: def.docsUrl,
        popularity: def.popularity,
        authType: def.authType,
        baseUrl: def.baseUrl,
        authConfig: JSON.parse(JSON.stringify(def.authConfig)) as JsonInput,
        pagination: JSON.parse(JSON.stringify(def.pagination)) as JsonInput,
        rateLimiting: def.rateLimiting ? (JSON.parse(JSON.stringify(def.rateLimiting)) as JsonInput) : undefined,
      },
      create: {
        slug: def.slug,
        name: def.name,
        description: def.description,
        category: def.category,
        subcategory: def.subcategory ?? null,
        docsUrl: def.docsUrl,
        popularity: def.popularity,
        authType: def.authType,
        baseUrl: def.baseUrl,
        authConfig: JSON.parse(JSON.stringify(def.authConfig)) as JsonInput,
        pagination: JSON.parse(JSON.stringify(def.pagination)) as JsonInput,
        rateLimiting: def.rateLimiting ? (JSON.parse(JSON.stringify(def.rateLimiting)) as JsonInput) : undefined,
      },
    });

    console.log(`  [${connector.slug}] connector upserted (${def.objects.length} objects)`);

    // Upsert each object
    for (const obj of def.objects) {
      await prisma.apiCatalogObject.upsert({
        where: {
          connectorId_slug: {
            connectorId: connector.id,
            slug: obj.slug,
          },
        },
        update: {
          name: obj.name,
          description: obj.description ?? null,
          endpoint: obj.endpoint,
          method: obj.method ?? "GET",
          responseRoot: obj.responseRoot,
          incrementalKey: obj.incrementalKey ?? null,
          defaultParams: obj.defaultParams ? (JSON.parse(JSON.stringify(obj.defaultParams)) as JsonInput) : undefined,
          schema: JSON.parse(JSON.stringify(obj.schema)) as JsonInput,
        },
        create: {
          connectorId: connector.id,
          slug: obj.slug,
          name: obj.name,
          description: obj.description ?? null,
          endpoint: obj.endpoint,
          method: obj.method ?? "GET",
          responseRoot: obj.responseRoot,
          incrementalKey: obj.incrementalKey ?? null,
          defaultParams: obj.defaultParams ? (JSON.parse(JSON.stringify(obj.defaultParams)) as JsonInput) : undefined,
          schema: JSON.parse(JSON.stringify(obj.schema)) as JsonInput,
        },
      });

      const colCount = obj.schema.columns.length;
      const childCount = obj.schema.childTables?.length ?? 0;
      console.log(`    [${obj.slug}] ${colCount} columns, ${childCount} child tables`);
    }
  }

  // Remove stale objects for connectors that no longer list them
  const allSlugs = ALL_CONNECTORS.map((c) => c.slug);
  const staleConnectors = await prisma.apiCatalogConnector.findMany({
    where: { slug: { notIn: allSlugs } },
  });
  if (staleConnectors.length > 0) {
    console.log(`  Removing ${staleConnectors.length} stale connector(s)...`);
    await prisma.apiCatalogConnector.deleteMany({
      where: { slug: { notIn: allSlugs } },
    });
  }

  console.log("API catalog seed complete.");
}
