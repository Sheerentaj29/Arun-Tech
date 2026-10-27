-- PostgreSQL immutability trigger for approved report revisions.
--
-- Once a ReportRevision is in the "Approved" or "Superseded" state, its
-- snapshotData, pdfPath, changeDescription, approvedById, approvedAt,
-- approvedByName, and revisedById fields are IMMUTABLE. Only the
-- status field may change (Approved → Superseded, when a newer
-- revision is approved).
--
-- This is a defense-in-depth measure: the API layer already prevents
-- updates to these fields, but this trigger makes the database itself
-- reject tampering — even by someone with direct SQL access.
--
-- Apply with: psql -d inspection_reports -f prisma/migrations/0002_immutable_approved_revisions.sql
-- (Or via PGlite in staging: bun run scripts/staging-provision-postgres.ts
--  which now applies this migration automatically.)

-- ─────────────────────────────────────────────────────────────────
-- Function: prevent approved-revision tampering
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_approved_revision_tamper()
RETURNS TRIGGER AS $$
BEGIN
  -- Only applies to revisions that are already Approved or Superseded
  IF OLD.status IN ('Approved', 'Superseded') THEN
    -- Allow changing status (Approved → Superseded is the normal flow)
    -- But block changes to any data field.
    -- NOTE: plpgsql requires double-quoted references to mixed-case columns.
    IF NEW."snapshotData" IS DISTINCT FROM OLD."snapshotData"
       OR NEW."pdfPath" IS DISTINCT FROM OLD."pdfPath"
       OR NEW."changeDescription" IS DISTINCT FROM OLD."changeDescription"
       OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById"
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
       OR NEW."approvedByName" IS DISTINCT FROM OLD."approvedByName"
       OR NEW."revisedById" IS DISTINCT FROM OLD."revisedById"
       OR NEW."revisedByName" IS DISTINCT FROM OLD."revisedByName"
       OR NEW."reviewComments" IS DISTINCT FROM OLD."reviewComments"
       OR NEW."revisionNumber" IS DISTINCT FROM OLD."revisionNumber"
       OR NEW."pipelineInspectionId" IS DISTINCT FROM OLD."pipelineInspectionId"
    THEN
      RAISE EXCEPTION 'ReportRevision % is in "%" state and cannot have its data fields modified. Only the status field may change.', OLD.id, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────
-- Trigger: fire BEFORE any UPDATE on ReportRevision
-- ─────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS report_revision_immutable ON "ReportRevision";
CREATE TRIGGER report_revision_immutable
  BEFORE UPDATE ON "ReportRevision"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_approved_revision_tamper();

-- ─────────────────────────────────────────────────────────────────
-- Also block DELETE on Approved/Superseded revisions
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_approved_revision_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('Approved', 'Superseded') THEN
    RAISE EXCEPTION 'ReportRevision % is in "%" state and cannot be deleted. Approved and Superseded revisions are permanent audit records.', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS report_revision_no_delete ON "ReportRevision";
CREATE TRIGGER report_revision_no_delete
  BEFORE DELETE ON "ReportRevision"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_approved_revision_delete();
