# Deletion drafts

Business-record DELETE endpoints now return HTTP 202 with `pendingDeletion: true`
and `requestId`. Clients must keep the record visible and show the pending message.
No record or uploaded file is removed at this stage.

Admin and CEO use `/admin/deletion-drafts` in the frontend:

- CEO approves or rejects a pending request.
- Admin cancels a pending request, or restores an approved deletion.
- An Admin without a persisted CEO role cannot approve a deletion.
- Authorization is reloaded from the database. Requests and actions are company scoped.
- A platform-wide request needs a platform CEO account; Superadmin alone does not
  bypass CEO approval. A deleted organization can be restored by platform Admin.

Covered records include employees, users, organization setup, roles/assignments,
assets, clients, salary structures/payroll/payslips, leave configuration, submitted
expenses, shifts, recruitment, onboarding, offers, surveys, tickets, KPI attachments,
organizations and subscription configuration. Personal notification dismissal,
push-token unregistration and clearing an unsent expense draft remain normal cleanup.

The approval transaction checks that the requested data has not changed, archives
employee-owned data and database cascade/SET NULL effects, and performs the deletion.
FK restrictions remain enabled. Circular/unsupported dependencies fail without
committing a partial deletion. Uploaded files are retained for restoration.

Restore inserts original IDs and restores affected references in one transaction.
ID/unique-key conflicts, missing parents, changed linked fields and incompatible
schema changes fail without overwriting current data. Review history is retained.

Deploy the `deletion_drafts` and `record_code` migrations before the new Node code.
The archive is AES-256-GCM encrypted using `DELETION_ARCHIVE_KEY`, or the existing
`JWT_SECRET` as fallback. Keep that key stable and backed up with the database;
changing it without re-encrypting archives makes old archives unreadable. Raw
archive contents are never returned by the review API.

Regression checks:

```sh
node --test src/services/deletionDrafts.test.js
```

The service tests use a transactional in-memory database double and do not modify
the configured production database. Frontend response propagation is covered by
`client/lib/deletionDrafts.test.ts`.
