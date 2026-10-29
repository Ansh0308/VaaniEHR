# Safety rule authoring preparation

This is Phase 7 preparation infrastructure, not a clinical safety suite. No safety rule is active, loaded by the API, used for prescribing, or used to change sign-off behaviour. Phase 7 remains **not implemented** until clinical content and its implementation are reviewed and accepted.

## Proposed scope awaiting confirmation

The proposed initial conditions are acute undifferentiated fever, acute respiratory infection or cough, acute gastroenteritis, hypertension follow-up, and uncomplicated urinary tract infection. They are not approved pathways or rule sets. A faculty guide and practising general-medicine clinician must confirm the scope before clinical authoring starts.

## Status and approval gate

`draft`, `review_pending`, and `disabled` documents may be incomplete and may retain `TODO(source)`, but they are always ineligible. A SHA-256 lock is an immutability record only; generating one never changes status or proves clinical approval.

A `clinically_approved` document requires all of the following, both at rule-set level and for every rule:

- Source metadata: `source_id`, `document_title`, `edition_or_version`, exact `locator` (page, section, or equivalent), `license_reuse`, and `citation`.
- Review metadata: `state: "approved"`, clinician `reviewer`, `reviewer_role`, valid calendar-date `reviewed_on`, and `approval_reference`.
- At least one rule, with every rule `enabled: true`. Disabled rules are rejected rather than silently skipped.
- A matching entry in the root-level `safety-rules.lock.json`.

No incomplete, unreviewed, disabled, draft, or review-pending document can become eligible through structural validation or locking.

## Commands and immutable lock format

Run `npm run safety:lint -- <directory-or-safety-file>` to read and validate all `*.safety.json` files recursively. It writes nothing. Empty directories, invalid paths, invalid JSON, invalid lock JSON, missing locks for approved sets, and lock mismatches are errors. Draft-only directories are valid but remain ineligible.

Run `npm run safety:lock -- <directory>` only after complete, explicitly approved content exists. It recursively discovers safety files and writes only missing lock entries to `<directory>/safety-rules.lock.json`. It rejects malformed or empty directories, drafts-only directories, invalid/unfinished approval metadata, and changed existing entries. Re-running it unchanged writes nothing. It never overwrites an existing lock entry: change the rule-set version instead.

The lock format is:

```json
{
  "schema_version": 1,
  "source": "Safety rule-set content hashes (immutability lock); not clinical approval.",
  "locks": {
    "rule_set_id@1": {
      "file": "nested/rule-set.safety.json",
      "sha256": "64 lowercase hexadecimal characters"
    }
  }
}
```

Hashes use canonical JSON serialization: object keys are recursively sorted and array order is preserved. Thus formatting and object-key order do not change a hash, but a source, reviewer, status, rule, or other meaningful change does.

## Future authoring workflow

1. Keep source materials outside Git where licensing requires it; record their identifier, title, edition/version, precise locator, and reuse terms.
2. Transcribe only clinician-reviewed content. Do not invent clinical values, medication advice, thresholds, interactions, or treatment directions.
3. Obtain explicit named clinician approval and its reference before setting `clinically_approved`.
4. Run `safety:lint`, then `safety:lock`. A later change requires a new version; never edit a locked approved version.
5. Add synthetic and clinician-reviewed unsafe-case tests before any separately approved future connection to an engine or sign-off.
