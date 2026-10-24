// Migration 0017 (Phase 10 Run 1, ADR-D41): the Gujarati WhatsApp summary of a SIGNED visit version and the log of what was sent.
//  - whatsapp_summary: one row per (session, signed version). It starts 'needs_review'. The doctor may change only the two
//    free-text fields (warning signs, follow-up) while it is a draft. On approval the exact Gujarati text and its four template
//    variables are stored with a SHA-256; an approved row can never be changed or deleted by the app role. A new signed version
//    (an amendment) needs a new summary row.
//  - whatsapp_message: the send log, in the shape of ClinicOS message_logs (patient, clinic, channel, template, status
//    sent / failed / delivered, error, sent time) plus what we need: the session, the summary, the provider and its message id.
//    The phone number is NOT stored: only its last four digits and a keyed hash (to match a STOP reply). Only the delivery
//    status and its time can change after insert, and a status only moves forward.
// The summary text is clinical content about the patient: returned to the doctor, never logged, never put in the audit log.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE TABLE whatsapp_summary (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES consultation_session (id),
    clinic_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    status text NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review', 'approved')),
    warning_signs text NOT NULL DEFAULT '' CHECK (length(warning_signs) <= 600),
    follow_up text NOT NULL DEFAULT '' CHECK (length(follow_up) <= 600),
    params jsonb NOT NULL,
    text_gu text NOT NULL,
    text_en text NOT NULL,
    phrase_table_version text NOT NULL,
    template_name text NOT NULL,
    text_hash text CHECK (text_hash IS NULL OR text_hash ~ '^[0-9a-f]{64}$'),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    approved_by uuid,
    approved_at timestamptz,
    UNIQUE (session_id, version),
    CONSTRAINT whatsapp_summary_approved_has_hash CHECK (
      (status = 'approved') = (text_hash IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    )
  )`);
  pgm.sql(
    'CREATE INDEX ix_whatsapp_summary_session ON whatsapp_summary (clinic_id, session_id, version)',
  );
  pgm.sql(`CREATE FUNCTION whatsapp_summary_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  pgm.sql(`CREATE TRIGGER whatsapp_summary_guard BEFORE UPDATE OR DELETE ON whatsapp_summary
    FOR EACH ROW EXECUTE FUNCTION whatsapp_summary_guard()`);
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON whatsapp_summary TO vaani_app');

  pgm.sql(`CREATE TABLE whatsapp_message (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    summary_id uuid NOT NULL REFERENCES whatsapp_summary (id),
    session_id uuid NOT NULL REFERENCES consultation_session (id),
    clinic_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel = 'whatsapp'),
    template text NOT NULL CHECK (length(template) BETWEEN 1 AND 100),
    status text NOT NULL CHECK (status IN ('sent', 'failed', 'delivered', 'read')),
    error_message text CHECK (error_message IS NULL OR length(error_message) <= 300),
    sent_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    provider text NOT NULL CHECK (provider IN ('mock', 'meta')),
    provider_message_id text,
    recipient_last4 text NOT NULL CHECK (recipient_last4 ~ '^[0-9]{1,4}$'),
    recipient_hash text NOT NULL CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
    text_hash text NOT NULL CHECK (text_hash ~ '^[0-9a-f]{64}$'),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT whatsapp_message_failed_has_error CHECK (status <> 'failed' OR error_message IS NOT NULL)
  )`);
  pgm.sql(
    'CREATE INDEX ix_whatsapp_message_session ON whatsapp_message (clinic_id, session_id, sent_at)',
  );
  pgm.sql(
    'CREATE UNIQUE INDEX ux_whatsapp_message_provider_id ON whatsapp_message (provider, provider_message_id) WHERE provider_message_id IS NOT NULL',
  );
  pgm.sql(
    'CREATE INDEX ix_whatsapp_message_recipient ON whatsapp_message (recipient_hash, sent_at)',
  );
  pgm.sql(`CREATE FUNCTION whatsapp_message_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  pgm.sql(`CREATE TRIGGER whatsapp_message_guard BEFORE UPDATE OR DELETE ON whatsapp_message
    FOR EACH ROW EXECUTE FUNCTION whatsapp_message_guard()`);
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON whatsapp_message TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS whatsapp_message');
  pgm.sql('DROP FUNCTION IF EXISTS whatsapp_message_guard()');
  pgm.sql('DROP TABLE IF EXISTS whatsapp_summary');
  pgm.sql('DROP FUNCTION IF EXISTS whatsapp_summary_guard()');
};
