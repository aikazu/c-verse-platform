create table public.collector_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  guide_dismissed boolean not null default false
);
alter table public.collector_preferences enable row level security;
revoke all on public.collector_preferences from anon, authenticated;
grant all on public.collector_preferences to service_role;
grant select, insert, update on public.collector_preferences to authenticated;
create policy collector_preferences_owner on public.collector_preferences for all to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.users where id = (select auth.uid()) and flag_reason is null
  ))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.users where id = (select auth.uid()) and flag_reason is null
  ));
