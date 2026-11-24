# Migrations

SQLx records a checksum of every migration it has applied. **Never edit a migration
after it has run anywhere** — not even to add a comment — or existing databases will
refuse to start ("migration was previously applied but has been modified"). Add a new
migration instead.

Line endings are the one exception: git can check the same file out with CRLF or LF
(the repository now stores LF, see `.gitattributes`). On start, `src/migrate_fix.rs`
updates a stored checksum when the only difference is line endings, and logs a
warning. Any other change still fails.

## Historical migrations that delete data

These ran early in development to clear out placeholder data. They are kept only so
existing databases stay valid:

| Migration | What it does |
|---|---|
| `20260915020000_remove_seeded_buyer_requirements.sql` | Deletes the placeholder buyer requirements created by `20260915000000_add_buyer_offers.sql`. |
| `20260915050000_reset_offer_settlement_data.sql` | Deletes all offers and transactions and reopens sold lots. |

Starter data does **not** come from migrations. It is created by `src/seed.rs`, which runs
after migrations on every start and only inserts what is missing, so a fresh database
always ends up with starter data for every portal and an existing one is never changed.
New migrations must not delete user data.
