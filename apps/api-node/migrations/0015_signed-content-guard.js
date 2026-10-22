// Migration 0015 (Phase 8 Run 2, ADR-D39): a narrow database guard so the FACTS and TRANSCRIPT SEGMENTS of a signed visit
// cannot be inserted, changed or deleted by the app role. Run 1 locked them only in the application (the registry flag
// `lockedWhenSigned`); this is the second guard.
// The ONE legitimate writer after signing is the consent-withdrawal path (deleteDraftSegments: it deletes unconfirmed
// facts and draft segments and marks a confirmed fact's segment as deleted, ADR-D28/D29). That function sets the
// transaction-local setting `vaani.withdrawal` to 'on' for its own statements and back to 'off' afterwards; a static test
// checks that no other file sets it. A setting is not a security boundary against code that is already malicious (it can
// set the flag too), it stops mistakes: a new route that forgets `lockedWhenSigned` now fails loudly instead of silently
// editing a signed record. The owner role (migrations, tests, fixtures) is not affected.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE FUNCTION signed_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE sid uuid;
  BEGIN
    IF current_user = 'vaani_app' AND coalesce(current_setting('vaani.withdrawal', true), 'off') <> 'on' THEN
      IF TG_OP = 'INSERT' THEN sid := NEW.session_id; ELSE sid := OLD.session_id; END IF;
      IF EXISTS (SELECT 1 FROM visit_record WHERE session_id = sid AND status = 'signed') THEN
        RAISE EXCEPTION 'the facts and transcript of a signed visit cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE TRIGGER extracted_fact_signed_guard BEFORE INSERT OR UPDATE OR DELETE ON extracted_fact
    FOR EACH ROW EXECUTE FUNCTION signed_content_guard()`);
  pgm.sql(`CREATE TRIGGER transcript_segment_signed_guard BEFORE INSERT OR UPDATE OR DELETE ON transcript_segment
    FOR EACH ROW EXECUTE FUNCTION signed_content_guard()`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS transcript_segment_signed_guard ON transcript_segment');
  pgm.sql('DROP TRIGGER IF EXISTS extracted_fact_signed_guard ON extracted_fact');
  pgm.sql('DROP FUNCTION IF EXISTS signed_content_guard()');
};
