-- v5.5: "Ask the data" bot — question log + daily limit (read / written only by the `ask` edge function with the service role)
create table if not exists bot_log (
  id bigserial primary key,
  emp_code text not null,
  q text not null,
  ok boolean not null default true,
  ms int,
  created_at timestamptz not null default now()
);
create index if not exists bot_log_emp_day on bot_log (emp_code, created_at);
alter table bot_log enable row level security;   -- no policies: anon / authenticated cannot read or write it
revoke all on bot_log from anon, authenticated;
