-- signol schema. Every table carries owner_id and is protected by Row Level Security.
-- Apply with `supabase db push` (hosted) or via the SQL editor.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  hypothesis text not null check (char_length(hypothesis) between 5 and 1000),
  target_customer text not null check (char_length(target_customer) between 2 and 500),
  -- Checkpoint 1: the pre-commitment, entered before any analysis.
  predicted_supporters int not null check (predicted_supporters between 0 and 15),
  predicted_confidence int not null check (predicted_confidence between 0 and 100),
  locked_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'locked', 'analyzing', 'analyzed', 'decided')),
  is_demo boolean not null default false,
  analysis_source text check (analysis_source in ('live', 'cached')),
  benchmark_manual_minutes int check (benchmark_manual_minutes is null or benchmark_manual_minutes between 1 and 6000),
  created_at timestamptz not null default now()
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  position int not null default 0,
  label text not null check (char_length(label) between 1 and 160),
  source_type text not null check (source_type in ('paste', 'text_file', 'docx', 'audio')),
  storage_path text,
  original_filename text,
  raw_text text,
  word_count int not null default 0,
  format text check (format in ('dialogue', 'notes')),
  speakers jsonb not null default '[]'::jsonb,
  needs_confirmation boolean not null default false,
  speakers_confirmed boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index on public.interviews (project_id, position);

create table public.turns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  interview_id uuid not null references public.interviews (id) on delete cascade,
  idx int not null,
  speaker text not null,
  role text not null check (role in ('interviewer', 'interviewee')),
  text text not null,
  unique (interview_id, idx)
);

create table public.statements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  interview_id uuid not null references public.interviews (id) on delete cascade,
  turn_idx int not null,
  type text not null check (type in ('past_behavior', 'current_pain', 'future_promise', 'compliment', 'opinion_general', 'irrelevant')),
  stance text not null check (stance in ('supports', 'contradicts', 'neutral')),
  quote text not null,
  quote_start int,
  quote_end int,
  rationale text not null,
  verified boolean not null default false,
  tainted boolean not null default false,
  tainted_by uuid,
  weight numeric not null default 0,
  created_at timestamptz not null default now()
);
create index on public.statements (project_id);
create index on public.statements (interview_id);

create table public.leading_questions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  interview_id uuid not null references public.interviews (id) on delete cascade,
  turn_idx int not null,
  question text not null,
  why_leading text not null,
  neutral_rewrite text not null,
  tainted_turn_idxs int[] not null default '{}',
  verified boolean not null default false
);
create index on public.leading_questions (project_id);

create table public.syntheses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null unique references public.projects (id) on delete cascade,
  themes jsonb not null default '[]'::jsonb,
  top_for jsonb not null default '[]'::jsonb,
  top_against jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  score jsonb not null default '{}'::jsonb,
  script jsonb,
  prompt_versions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null unique references public.projects (id) on delete cascade,
  choice text not null check (choice in ('validated', 'invalidated', 'need_more_evidence')),
  responses jsonb not null default '[]'::jsonb,
  calibration jsonb not null default '{}'::jsonb,
  -- Immutable snapshot used for exports and the read-only share link.
  log jsonb not null default '{}'::jsonb,
  share_token text unique,
  decided_at timestamptz not null default now()
);

create table public.run_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  step text not null,
  provider text not null,
  model text not null default '',
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  latency_ms int not null default 0,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index on public.run_logs (project_id);

create table public.timing_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  event text not null check (event in ('analysis_started', 'analysis_finished', 'board_viewed', 'decision_made')),
  meta jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index on public.timing_events (project_id);

-- Per-step status so a failed run resumes from the failed step.
create table public.pipeline_steps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  interview_id uuid references public.interviews (id) on delete cascade,
  step text not null,
  step_key text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error', 'blocked')),
  note text,
  error text,
  attempts int not null default 0,
  updated_at timestamptz not null default now(),
  unique (project_id, step_key)
);

-- ---------------------------------------------------------------- guards

-- Checkpoint 1: hypothesis and prediction cannot change once locked.
create function public.projects_lock_guard() returns trigger
language plpgsql as $$
begin
  if old.locked_at is not null then
    if new.locked_at is distinct from old.locked_at
       or new.hypothesis is distinct from old.hypothesis
       or new.target_customer is distinct from old.target_customer
       or new.predicted_supporters is distinct from old.predicted_supporters
       or new.predicted_confidence is distinct from old.predicted_confidence then
      raise exception 'The hypothesis and prediction are locked once analysis has started.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger projects_lock_guard before update on public.projects
  for each row execute function public.projects_lock_guard();

-- A decision is immutable except for adding a share token.
create function public.decisions_immutable() returns trigger
language plpgsql as $$
begin
  if new.choice is distinct from old.choice
     or new.responses is distinct from old.responses
     or new.calibration is distinct from old.calibration
     or new.log is distinct from old.log
     or new.decided_at is distinct from old.decided_at
     or new.project_id is distinct from old.project_id then
    raise exception 'A recorded decision cannot be edited.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger decisions_immutable before update on public.decisions
  for each row execute function public.decisions_immutable();

-- ---------------------------------------------------------------- RLS

create function public.owns_project(p uuid) returns boolean
language sql stable security invoker as $$
  select exists (select 1 from public.projects where id = p and owner_id = auth.uid())
$$;

alter table public.projects enable row level security;
create policy projects_select on public.projects for select using (owner_id = auth.uid());
create policy projects_insert on public.projects for insert with check (owner_id = auth.uid());
create policy projects_update on public.projects for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy projects_delete on public.projects for delete using (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['interviews', 'turns', 'statements', 'leading_questions', 'syntheses', 'decisions', 'run_logs', 'timing_events', 'pipeline_steps']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (owner_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (owner_id = auth.uid() and public.owns_project(project_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.owns_project(project_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (owner_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.owns_project(uuid) to authenticated;

-- ---------------------------------------------------------------- read-only sharing

-- The share link exposes ONLY the frozen decision-log snapshot, addressed by an unguessable token.
create function public.shared_decision_log(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select d.log || jsonb_build_object('shared', true)
  from public.decisions d
  where d.share_token is not null and d.share_token = p_token
$$;
revoke all on function public.shared_decision_log(text) from public;
grant execute on function public.shared_decision_log(text) to anon, authenticated;

-- ---------------------------------------------------------------- time-saved statistics

-- One row of computed numbers per project. p_all = true aggregates every project but
-- returns NO content (no hypotheses, quotes or ids), only counts and durations.
create function public.stats_rows(p_all boolean default false)
returns table (
  is_demo boolean,
  analysis_seconds numeric,
  board_seconds numeric,
  time_to_decision_seconds numeric,
  model_calls int,
  failed_calls int,
  tokens_in bigint,
  tokens_out bigint,
  benchmark_manual_minutes int,
  analysis_source text
)
language sql stable security definer set search_path = public as $$
  select
    p.is_demo,
    extract(epoch from (
      (select max(at) from timing_events e where e.project_id = p.id and e.event = 'analysis_finished') -
      (select min(at) from timing_events e where e.project_id = p.id and e.event = 'analysis_started')))::numeric,
    coalesce((select sum((e.meta ->> 'seconds')::numeric) from timing_events e where e.project_id = p.id and e.event = 'board_viewed'), 0),
    extract(epoch from (
      (select max(at) from timing_events e where e.project_id = p.id and e.event = 'decision_made') -
      (select min(at) from timing_events e where e.project_id = p.id and e.event = 'analysis_started')))::numeric,
    (select count(*) from run_logs r where r.project_id = p.id and r.ok and r.provider <> 'cached')::int,
    (select count(*) from run_logs r where r.project_id = p.id and not r.ok)::int,
    coalesce((select sum(tokens_in) from run_logs r where r.project_id = p.id), 0),
    coalesce((select sum(tokens_out) from run_logs r where r.project_id = p.id), 0),
    p.benchmark_manual_minutes,
    p.analysis_source
  from projects p
  where p.analysis_source is not null
    and (p_all or p.owner_id = auth.uid())
$$;
revoke all on function public.stats_rows(boolean) from public;
grant execute on function public.stats_rows(boolean) to anon, authenticated;
