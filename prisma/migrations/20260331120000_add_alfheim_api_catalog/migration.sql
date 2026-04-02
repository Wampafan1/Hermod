-- CreateEnum: ApiAuthType
CREATE TYPE "ApiAuthType" AS ENUM ('API_KEY', 'BEARER', 'BASIC', 'OAUTH2', 'CUSTOM');

-- AlterEnum: Add REST_API to ConnectionType
ALTER TYPE "ConnectionType" ADD VALUE 'REST_API';

-- CreateTable: ApiCatalogConnector
CREATE TABLE "ApiCatalogConnector" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "logoUrl" TEXT,
    "docsUrl" TEXT,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "authType" "ApiAuthType" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authConfig" JSONB NOT NULL,
    "pagination" JSONB NOT NULL,
    "rateLimiting" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "ApiCatalogConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ApiCatalogObject
CREATE TABLE "ApiCatalogObject" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "responseRoot" TEXT NOT NULL,
    "incrementalKey" TEXT,
    "defaultParams" JSONB,
    "schema" JSONB NOT NULL,

    CONSTRAINT "ApiCatalogObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: ApiCatalogConnector.slug
CREATE UNIQUE INDEX "ApiCatalogConnector_slug_key" ON "ApiCatalogConnector"("slug");

-- CreateIndex: ApiCatalogConnector.category
CREATE INDEX "ApiCatalogConnector_category_idx" ON "ApiCatalogConnector"("category");

-- CreateIndex: ApiCatalogConnector.enabled
CREATE INDEX "ApiCatalogConnector_enabled_idx" ON "ApiCatalogConnector"("enabled");

-- CreateIndex: ApiCatalogObject (connectorId, slug) unique
CREATE UNIQUE INDEX "ApiCatalogObject_connectorId_slug_key" ON "ApiCatalogObject"("connectorId", "slug");

-- AddForeignKey: ApiCatalogObject → ApiCatalogConnector
ALTER TABLE "ApiCatalogObject" ADD CONSTRAINT "ApiCatalogObject_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "ApiCatalogConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
