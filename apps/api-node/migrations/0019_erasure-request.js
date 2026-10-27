// Migration 0019 (Phase 12B Run 2, ADR-D45; PRD PG-20): erasure requests and the narrow database exceptions an erasure needs.
//  - erasure_request: a request recorded by staff or an admin on behalf of a patient, and its way through the admin queue
//    (received -> in_review -> completed | refused). Status only moves forward; a refusal needs a reason; a completion keeps
//    the COUNTS of what was removed (never the content). One open request per patient.
//  - Completing a request removes everything about the patient that is NOT part of a SIGNED visit record. Seven guards from earlier
//    migrations refuse such deletes on purpose (a confirmed transcript segment, a confirmed fact, an acknowledged red flag, a selected
//    working condition, a stored FHIR bundle, a WhatsApp summary, a WhatsApp message record). Each is replaced by a copy that allows exactly one more thing: a DELETE by the app role while the
//    transaction-local setting `vaani.erasure` is 'on'. For transcript segments and facts that exception does not apply to a
//    session whose visit is signed (a signed record, and the facts and text it rests on, stay). The setting is switched on only by
//    src/privacy/service.ts (a static test checks that), the same way `vaani.withdrawal` works (migration 0015).
//  - DELETE is granted on the derived tables an erasure empties (FHIR bundles, WhatsApp summaries and messages, ABHA rows, the
//    clinical profile). Nothing else in the code deletes from them (static test).
// The signed visit versions, the visit record, the audit log and the consent events are never deleted.
// patient_id and clinic_id are plain ids (no foreign keys to the ClinicOS stand-ins, ADR-D20).

const ERASURE_ON = "coalesce(current_setting('vaani.erasure', true), 'off') = 'on'";
const SIGNED = (col) =>
  `EXISTS (SELECT 1 FROM visit_record WHERE session_id = ${col} AND status = 'signed')`;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE TABLE erasure_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'in_review', 'completed', 'refused')),
    channel text NOT NULL CHECK (channel IN ('in_person', 'phone', 'written')),
    note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    requested_by uuid NOT NULL,
    requested_by_role text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    reviewed_by uuid,
    reviewed_at timestamptz,
    decided_by uuid,
    decided_at timestamptz,
    refusal_reason text CHECK (refusal_reason IS NULL OR length(refusal_reason) BETWEEN 3 AND 500),
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT erasure_refused_has_reason CHECK ((status = 'refused') = (refusal_reason IS NOT NULL)),
    CONSTRAINT erasure_completed_has_result CHECK ((status = 'completed') = (result IS NOT NULL)),
    CONSTRAINT erasure_decided_has_decider CHECK ((status IN ('completed', 'refused')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL))
  )`);
  pgm.sql(
    'CREATE INDEX ix_erasure_request_queue ON erasure_request (clinic_id, status, received_at)',
  );
  pgm.sql(`CREATE UNIQUE INDEX ux_erasure_request_open ON erasure_request (clinic_id, patient_id)
    WHERE status IN ('received', 'in_review')`);
  pgm.sql(`CREATE FUNCTION erasure_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'an erasure request cannot be deleted'; END IF;
      IF NEW.clinic_id <> OLD.clinic_id OR NEW.patient_id <> OLD.patient_id OR NEW.requested_by <> OLD.requested_by
         OR NEW.requested_by_role <> OLD.requested_by_role OR NEW.channel <> OLD.channel OR NEW.note <> OLD.note
         OR NEW.received_at <> OLD.received_at THEN
        RAISE EXCEPTION 'the identity of an erasure request cannot be changed';
      END IF;
      IF OLD.status IN ('completed', 'refused') THEN
        RAISE EXCEPTION 'a decided erasure request cannot be changed';
      END IF;
      IF NOT ((OLD.status = 'received' AND NEW.status IN ('received', 'in_review', 'refused'))
           OR (OLD.status = 'in_review' AND NEW.status IN ('in_review', 'completed', 'refused'))) THEN
        RAISE EXCEPTION 'an erasure request only moves forward: received, in review, then completed or refused';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE TRIGGER erasure_request_guard BEFORE UPDATE OR DELETE ON erasure_request
    FOR EACH ROW EXECUTE FUNCTION erasure_request_guard()`);
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON erasure_request TO vaani_app');
  pgm.sql(
    'GRANT DELETE ON fhir_bundle, whatsapp_summary, whatsapp_message, abha_link, abha_txn, patient_clinical_profile TO vaani_app',
  );

  // --- the four guards, each with one added exception (see the header)
  pgm.sql(`CREATE OR REPLACE FUNCTION transcript_segment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF OLD.status = 'confirmed' THEN
        IF NOT (TG_OP = 'DELETE' AND ${ERASURE_ON} AND NOT ${SIGNED('OLD.session_id')}) THEN
          RAISE EXCEPTION 'a confirmed transcript segment cannot be changed or deleted';
        END IF;
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.original_text <> OLD.original_text OR NEW.engine <> OLD.engine
         OR NEW.seq <> OLD.seq OR NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id) THEN
        RAISE EXCEPTION 'the engine text, engine, sequence and session of a segment cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION extracted_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'confirmed'
           AND NOT (${ERASURE_ON} AND NOT ${SIGNED('OLD.session_id')}) THEN
          RAISE EXCEPTION 'a confirmed fact cannot be deleted';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id OR NEW.type <> OLD.type
         OR NEW.source <> OLD.source OR NEW.pipeline <> OLD.pipeline
         OR NEW.evidence_quote IS DISTINCT FROM OLD.evidence_quote THEN
        RAISE EXCEPTION 'the identity and the evidence of a fact cannot be changed';
      END IF;
      IF NEW.source_segment_id IS DISTINCT FROM OLD.source_segment_id
         AND NOT (NEW.source_segment_id IS NULL AND NEW.segment_deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'the source segment of a fact cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION whatsapp_summary_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF NOT ${ERASURE_ON} THEN RAISE EXCEPTION 'a WhatsApp summary cannot be deleted'; END IF;
        RETURN OLD;
      END IF;
      IF OLD.status = 'approved' THEN
        RAISE EXCEPTION 'an approved WhatsApp summary cannot be changed';
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id OR NEW.patient_id <> OLD.patient_id
         OR NEW.version <> OLD.version OR NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'the identity of a WhatsApp summary cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION whatsapp_message_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF NOT ${ERASURE_ON} THEN RAISE EXCEPTION 'a WhatsApp message record cannot be deleted'; END IF;
        RETURN OLD;
      END IF;
      IF NEW.summary_id <> OLD.summary_id OR NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id
         OR NEW.patient_id <> OLD.patient_id OR NEW.template <> OLD.template OR NEW.sent_at <> OLD.sent_at
         OR NEW.provider <> OLD.provider OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
         OR NEW.recipient_hash <> OLD.recipient_hash OR NEW.recipient_last4 <> OLD.recipient_last4
         OR NEW.text_hash <> OLD.text_hash OR NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'only the delivery status of a WhatsApp message record can change';
      END IF;
      IF (OLD.status = 'failed' AND NEW.status <> 'failed')
         OR (OLD.status = 'read' AND NEW.status <> 'read')
         OR (OLD.status = 'delivered' AND NEW.status NOT IN ('delivered', 'read')) THEN
        RAISE EXCEPTION 'a WhatsApp delivery status only moves forward';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);

  pgm.sql(`CREATE OR REPLACE FUNCTION fhir_bundle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF NOT ${ERASURE_ON} THEN RAISE EXCEPTION 'a stored FHIR bundle cannot be deleted'; END IF;
        RETURN OLD;
      END IF;
      IF NEW.bundle IS DISTINCT FROM OLD.bundle OR NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id
         OR NEW.version <> OLD.version OR NEW.kind <> OLD.kind OR NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'a stored FHIR bundle cannot be changed, only its validation result';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION question_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'acknowledged' AND NOT (${ERASURE_ON} AND NOT ${SIGNED('OLD.session_id')}) THEN
          RAISE EXCEPTION 'an acknowledged red flag cannot be deleted';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id
         OR NEW.pathway_id <> OLD.pathway_id OR NEW.pathway_version <> OLD.pathway_version
         OR NEW.node_id <> OLD.node_id OR NEW.slot <> OLD.slot OR NEW.kind <> OLD.kind THEN
        RAISE EXCEPTION 'the identity of a question event cannot be changed';
      END IF;
      IF OLD.status <> 'suggested' THEN
        RAISE EXCEPTION 'an acted-on question event cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF OLD.kind = 'selected' AND NOT (${ERASURE_ON} AND NOT ${SIGNED('OLD.session_id')}) THEN
          RAISE EXCEPTION 'a doctor-selected working condition cannot be deleted';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id OR NEW.kind <> OLD.kind
         OR NEW.pathway_id IS DISTINCT FROM OLD.pathway_id
         OR NEW.pathway_version IS DISTINCT FROM OLD.pathway_version
         OR NEW.not_listed <> OLD.not_listed OR NEW.not_listed_text IS DISTINCT FROM OLD.not_listed_text
         OR NEW.selected_by IS DISTINCT FROM OLD.selected_by THEN
        RAISE EXCEPTION 'a candidate row cannot be rewritten';
      END IF;
      IF OLD.kind = 'derived' THEN
        RAISE EXCEPTION 'a derived candidate cannot be changed, only replaced';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  // back to the guards of migrations 0010, 0011 and 0017
  pgm.sql(`CREATE OR REPLACE FUNCTION transcript_segment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF OLD.status = 'confirmed' THEN
        RAISE EXCEPTION 'a confirmed transcript segment cannot be changed or deleted';
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.original_text <> OLD.original_text OR NEW.engine <> OLD.engine
         OR NEW.seq <> OLD.seq OR NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id) THEN
        RAISE EXCEPTION 'the engine text, engine, sequence and session of a segment cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION extracted_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'confirmed' THEN
          RAISE EXCEPTION 'a confirmed fact cannot be deleted';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id OR NEW.type <> OLD.type
         OR NEW.source <> OLD.source OR NEW.pipeline <> OLD.pipeline
         OR NEW.evidence_quote IS DISTINCT FROM OLD.evidence_quote THEN
        RAISE EXCEPTION 'the identity and the evidence of a fact cannot be changed';
      END IF;
      IF NEW.source_segment_id IS DISTINCT FROM OLD.source_segment_id
         AND NOT (NEW.source_segment_id IS NULL AND NEW.segment_deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'the source segment of a fact cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION whatsapp_summary_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a WhatsApp summary cannot be deleted';
      END IF;
      IF OLD.status = 'approved' THEN
        RAISE EXCEPTION 'an approved WhatsApp summary cannot be changed';
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id OR NEW.patient_id <> OLD.patient_id
         OR NEW.version <> OLD.version OR NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'the identity of a WhatsApp summary cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION whatsapp_message_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a WhatsApp message record cannot be deleted';
      END IF;
      IF NEW.summary_id <> OLD.summary_id OR NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id
         OR NEW.patient_id <> OLD.patient_id OR NEW.template <> OLD.template OR NEW.sent_at <> OLD.sent_at
         OR NEW.provider <> OLD.provider OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
         OR NEW.recipient_hash <> OLD.recipient_hash OR NEW.recipient_last4 <> OLD.recipient_last4
         OR NEW.text_hash <> OLD.text_hash OR NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'only the delivery status of a WhatsApp message record can change';
      END IF;
      IF (OLD.status = 'failed' AND NEW.status <> 'failed')
         OR (OLD.status = 'read' AND NEW.status <> 'read')
         OR (OLD.status = 'delivered' AND NEW.status NOT IN ('delivered', 'read')) THEN
        RAISE EXCEPTION 'a WhatsApp delivery status only moves forward';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION fhir_bundle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a stored FHIR bundle cannot be deleted';
      END IF;
      IF NEW.bundle IS DISTINCT FROM OLD.bundle OR NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id
         OR NEW.version <> OLD.version OR NEW.kind <> OLD.kind OR NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'a stored FHIR bundle cannot be changed, only its validation result';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION question_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'acknowledged' THEN
          RAISE EXCEPTION 'an acknowledged red flag cannot be deleted';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id
         OR NEW.pathway_id <> OLD.pathway_id OR NEW.pathway_version <> OLD.pathway_version
         OR NEW.node_id <> OLD.node_id OR NEW.slot <> OLD.slot OR NEW.kind <> OLD.kind THEN
        RAISE EXCEPTION 'the identity of a question event cannot be changed';
      END IF;
      IF OLD.status <> 'suggested' THEN
        RAISE EXCEPTION 'an acted-on question event cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE OR REPLACE FUNCTION candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF OLD.kind = 'selected' THEN
          RAISE EXCEPTION 'a doctor-selected working condition cannot be deleted';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id OR NEW.kind <> OLD.kind
         OR NEW.pathway_id IS DISTINCT FROM OLD.pathway_id
         OR NEW.pathway_version IS DISTINCT FROM OLD.pathway_version
         OR NEW.not_listed <> OLD.not_listed OR NEW.not_listed_text IS DISTINCT FROM OLD.not_listed_text
         OR NEW.selected_by IS DISTINCT FROM OLD.selected_by THEN
        RAISE EXCEPTION 'a candidate row cannot be rewritten';
      END IF;
      IF OLD.kind = 'derived' THEN
        RAISE EXCEPTION 'a derived candidate cannot be changed, only replaced';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(
    'REVOKE DELETE ON fhir_bundle, whatsapp_summary, whatsapp_message, abha_link, abha_txn, patient_clinical_profile FROM vaani_app',
  );
  pgm.sql('DROP TRIGGER IF EXISTS erasure_request_guard ON erasure_request');
  pgm.sql('DROP FUNCTION IF EXISTS erasure_request_guard()');
  pgm.sql('DROP TABLE IF EXISTS erasure_request');
};
