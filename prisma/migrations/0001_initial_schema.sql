-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "address" TEXT,
    "logoPath" TEXT,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plant" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orientation" TEXT,
    "diameter" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "length" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "capacity" DOUBLE PRECISION,
    "wallThickness" DOUBLE PRECISION,
    "nominalDiameter" DOUBLE PRECISION,
    "outsideDiameter" DOUBLE PRECISION,
    "tubeLength" DOUBLE PRECISION,
    "shellDiameter" DOUBLE PRECISION,
    "material" TEXT,
    "manufacturer" TEXT,
    "serialNumber" TEXT,
    "clientId" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "tagNumber" TEXT,
    "dimensionSource" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'Unverified',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "inspectionDate" TIMESTAMP(3) NOT NULL,
    "inspectionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "summary" TEXT,
    "observations" TEXT,
    "measurements" TEXT,
    "photoCount" INTEGER NOT NULL DEFAULT 0,
    "reportPath" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipeStandard" (
    "id" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "edition" TEXT NOT NULL,
    "nominalSizeInch" TEXT NOT NULL,
    "nominalSizeMm" DOUBLE PRECISION NOT NULL,
    "dn" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "wallThicknessMm" DOUBLE PRECISION NOT NULL,
    "oD_mm" DOUBLE PRECISION,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipeStandard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComponentType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComponentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineInspection" (
    "id" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "inspectionArea" TEXT,
    "pipelineDescription" TEXT,
    "pipelineIdentificationNumber" TEXT,
    "isometricDrawingNumber" TEXT,
    "materialOfConstruction" TEXT,
    "applicableStandard" TEXT,
    "standardEdition" TEXT,
    "inspectionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "inspectorId" TEXT NOT NULL,
    "inspectorName" TEXT NOT NULL,
    "findingsSummary" TEXT,
    "comments" TEXT,
    "photos" TEXT,
    "overrideReason" TEXT,
    "overrideAppliedById" TEXT,
    "overrideAppliedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNotes" TEXT,
    "returnedById" TEXT,
    "returnedAt" TIMESTAMP(3),
    "reviewComments" TEXT,
    "currentApprovedRevisionId" TEXT,
    "pdfPath" TEXT,
    "signedPdfPath" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThicknessMeasurement" (
    "id" TEXT NOT NULL,
    "pipelineInspectionId" TEXT NOT NULL,
    "pointNo" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "pipeSizeInch" TEXT NOT NULL,
    "pipeSchedule" TEXT NOT NULL,
    "nominalThicknessMm" DOUBLE PRECISION,
    "nominalOverride" DOUBLE PRECISION,
    "standardId" TEXT,
    "componentTypeId" TEXT,
    "componentTypeCode" TEXT NOT NULL,
    "northMm" DOUBLE PRECISION,
    "northStatus" TEXT NOT NULL DEFAULT 'NotMeasured',
    "eastMm" DOUBLE PRECISION,
    "eastStatus" TEXT NOT NULL DEFAULT 'NotMeasured',
    "southMm" DOUBLE PRECISION,
    "southStatus" TEXT NOT NULL DEFAULT 'NotMeasured',
    "westMm" DOUBLE PRECISION,
    "westStatus" TEXT NOT NULL DEFAULT 'NotMeasured',
    "observedMinimumMm" DOUBLE PRECISION,
    "observedMinimumOverride" DOUBLE PRECISION,
    "findingsComments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThicknessMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRevision" (
    "id" TEXT NOT NULL,
    "pipelineInspectionId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "revisionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "revisedById" TEXT,
    "revisedByName" TEXT,
    "changeDescription" TEXT,
    "pdfPath" TEXT,
    "snapshotData" TEXT,
    "reviewComments" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- CreateIndex
CREATE INDEX "Equipment_clientId_idx" ON "Equipment"("clientId");

-- CreateIndex
CREATE INDEX "Equipment_plantId_idx" ON "Equipment"("plantId");

-- CreateIndex
CREATE INDEX "Equipment_category_idx" ON "Equipment"("category");

-- CreateIndex
CREATE INDEX "Equipment_type_idx" ON "Equipment"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_clientId_equipmentId_key" ON "Equipment"("clientId", "equipmentId");

-- CreateIndex
CREATE INDEX "Inspection_equipmentId_idx" ON "Inspection"("equipmentId");

-- CreateIndex
CREATE INDEX "Inspection_inspectorId_idx" ON "Inspection"("inspectorId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "PipeStandard_standard_nominalSizeInch_idx" ON "PipeStandard"("standard", "nominalSizeInch");

-- CreateIndex
CREATE UNIQUE INDEX "PipeStandard_standard_edition_nominalSizeInch_schedule_key" ON "PipeStandard"("standard", "edition", "nominalSizeInch", "schedule");

-- CreateIndex
CREATE UNIQUE INDEX "ComponentType_code_key" ON "ComponentType"("code");

-- CreateIndex
CREATE INDEX "PipelineInspection_clientId_idx" ON "PipelineInspection"("clientId");

-- CreateIndex
CREATE INDEX "PipelineInspection_plantId_idx" ON "PipelineInspection"("plantId");

-- CreateIndex
CREATE INDEX "PipelineInspection_inspectorId_idx" ON "PipelineInspection"("inspectorId");

-- CreateIndex
CREATE INDEX "PipelineInspection_status_idx" ON "PipelineInspection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineInspection_clientId_reportNumber_key" ON "PipelineInspection"("clientId", "reportNumber");

-- CreateIndex
CREATE INDEX "ThicknessMeasurement_pipelineInspectionId_idx" ON "ThicknessMeasurement"("pipelineInspectionId");

-- CreateIndex
CREATE INDEX "ThicknessMeasurement_pipeSizeInch_pipeSchedule_idx" ON "ThicknessMeasurement"("pipeSizeInch", "pipeSchedule");

-- CreateIndex
CREATE INDEX "ReportRevision_pipelineInspectionId_idx" ON "ReportRevision"("pipelineInspectionId");

-- CreateIndex
CREATE INDEX "ReportRevision_status_idx" ON "ReportRevision"("status");

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipeStandard" ADD CONSTRAINT "PipeStandard_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineInspection" ADD CONSTRAINT "PipelineInspection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineInspection" ADD CONSTRAINT "PipelineInspection_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineInspection" ADD CONSTRAINT "PipelineInspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineInspection" ADD CONSTRAINT "PipelineInspection_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineInspection" ADD CONSTRAINT "PipelineInspection_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThicknessMeasurement" ADD CONSTRAINT "ThicknessMeasurement_pipelineInspectionId_fkey" FOREIGN KEY ("pipelineInspectionId") REFERENCES "PipelineInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThicknessMeasurement" ADD CONSTRAINT "ThicknessMeasurement_componentTypeId_fkey" FOREIGN KEY ("componentTypeId") REFERENCES "ComponentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThicknessMeasurement" ADD CONSTRAINT "ThicknessMeasurement_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "PipeStandard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRevision" ADD CONSTRAINT "ReportRevision_pipelineInspectionId_fkey" FOREIGN KEY ("pipelineInspectionId") REFERENCES "PipelineInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRevision" ADD CONSTRAINT "ReportRevision_revisedById_fkey" FOREIGN KEY ("revisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRevision" ADD CONSTRAINT "ReportRevision_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

