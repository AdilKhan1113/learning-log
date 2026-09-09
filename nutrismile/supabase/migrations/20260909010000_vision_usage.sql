-- Per-user daily usage of the paid vision estimator.
--
-- The app's anon key ships inside the installable bundle and can be extracted
-- from it, so "holds a valid anon key" is not evidence of anything. The
-- estimator costs real money per call, so it counts calls against the signed-in
-- user and refuses past a daily limit.
--
-- Only the service role touches this table. It has row-level security enabled
-- with no policies at all, which denies every normal client outright — a user
-- must not be able to read, reset, or inflate their own counter.

create table if not exists vision_usage (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  count    integer not null default 0,
  primary key (user_id, day)
);

alter table vision_usage enable row level security;

-- Deliberately no policies. The service role bypasses RLS; everyone else is
-- denied. Removing this line would expose one user's usage to another.

/**
 * Count one call and return the new total for today.
 *
 * Done in the database rather than as read-then-write in the function, so two
 * requests arriving together cannot both read the same count and each think
 * they are under the limit.
 */
create or replace function record_vision_use(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into vision_usage (user_id, day, count)
  values (p_user_id, current_date, 1)
  on conflict (user_id, day)
  do update set count = vision_usage.count + 1
  returning count into new_count;

  return new_count;
end;
$$;

revoke all on function record_vision_use(uuid) from public, anon, authenticated;
