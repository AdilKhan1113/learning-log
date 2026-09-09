-- Deletion codes.
--
-- Google Play requires a way to delete an account that works without
-- installing the app. That is easy for an account with an email and awkward
-- for an anonymous one, which by definition carries no identifier a stranger
-- on a web page could present.
--
-- So the app hands the user a code while they are signed in, to keep like a
-- recovery key. The public page accepts that code and nothing else.
--
-- The code is stored hashed. A leak of this table must not let anyone delete
-- anybody's account — the same reason passwords are not stored in the clear.
-- One row per user: minting a new code replaces the old one, so a code the
-- user thinks they revoked really is dead.

create table if not exists deletion_codes (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  code_hash   text not null,
  created_at  bigint not null
);

-- The public page looks a code up by its hash, so that is the read path.
create index if not exists idx_deletion_codes_hash on deletion_codes (code_hash);

alter table deletion_codes enable row level security;

-- Deliberately no policies: only the service role may read or write. A user
-- must not be able to list codes, and certainly not somebody else's.
