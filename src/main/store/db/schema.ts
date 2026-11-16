import type { Db } from './driver'

/**
 * 迁移按数组顺序执行，已执行的条数记在 PRAGMA user_version。
 * 只能追加，不能改历史条目。
 */
const MIGRATIONS: string[] = [
  // v1：明细 + 分钟/日聚合。历史行冗余存供应商与模型快照，删配置也不断链。
  `
  create table requests (
    id text primary key,
    ts integer not null,
    day text not null,
    source text not null,
    status integer not null,
    ok integer not null,
    error_kind text,
    stream integer not null,
    ttft_ms integer,
    duration_ms integer not null,
    input_tokens integer not null,
    output_tokens integer not null,
    cache_read_tokens integer not null,
    cache_write_tokens integer not null,
    cost real not null,
    currency text not null,
    model_id text not null,
    alias text not null,
    provider_id text not null,
    provider_name text not null,
    base_url text not null,
    upstream_model text not null,
    note text
  );
  create index idx_requests_ts on requests (ts);
  create index idx_requests_model_ts on requests (model_id, ts);
  create index idx_requests_provider_ts on requests (provider_id, ts);
  create index idx_requests_ok on requests (ok);

  create table rollup_minute (
    minute integer not null,
    model_id text not null,
    provider_id text not null,
    source text not null,
    requests integer not null default 0,
    errors integer not null default 0,
    input integer not null default 0,
    output integer not null default 0,
    cache_read integer not null default 0,
    cache_write integer not null default 0,
    cost real not null default 0,
    primary key (minute, model_id, source)
  );
  create index idx_minute_minute on rollup_minute (minute);

  create table rollup_day (
    day text not null,
    model_id text not null,
    provider_id text not null,
    source text not null,
    requests integer not null default 0,
    errors integer not null default 0,
    input integer not null default 0,
    output integer not null default 0,
    cache_read integer not null default 0,
    cache_write integer not null default 0,
    cost real not null default 0,
    primary key (day, model_id, source)
  );
  create index idx_day_day on rollup_day (day);
  `,
  // v2：请求落库时记录当时单价（每百万 token、人民币），成本可逐行复核
  `
  alter table requests add column price_in real;
  alter table requests add column price_out real;
  alter table requests add column price_cache_read real;
  alter table requests add column price_cache_write real;
  `,
  // v3：运行日志（启动、代理、探针、校准、设置等）统一落库，供日志页筛选
  `
  create table app_logs (
    id text primary key,
    ts integer not null,
    level text not null,
    scope text not null,
    message text not null
  );
  create index idx_app_logs_ts on app_logs (ts);
  `,
  // v4：请求记录命中的接入 token 及其备注，并按 token 备注建聚合
  `
  alter table requests add column token_id text;
  alter table requests add column token_remark text;
  create index idx_requests_token_ts on requests (token_remark, ts);

  create table rollup_token_minute (
    minute integer not null,
    token_remark text not null,
    source text not null,
    requests integer not null default 0,
    errors integer not null default 0,
    input integer not null default 0,
    output integer not null default 0,
    cache_read integer not null default 0,
    cache_write integer not null default 0,
    cost real not null default 0,
    primary key (minute, token_remark, source)
  );
  create table rollup_token_day (
    day text not null,
    token_remark text not null,
    source text not null,
    requests integer not null default 0,
    errors integer not null default 0,
    input integer not null default 0,
    output integer not null default 0,
    cache_read integer not null default 0,
    cache_write integer not null default 0,
    cost real not null default 0,
    primary key (day, token_remark, source)
  );
  create index idx_token_day on rollup_token_day (day);
  `,
  // v5：历史请求没有 token 备注，统一记为「默认」，并从明细回填 token 聚合
  `
  update requests set token_remark = '默认' where token_remark is null;
  insert into rollup_token_minute (minute, token_remark, source, requests, errors, input, output, cache_read, cache_write, cost)
  select (ts / 60000) * 60000, '默认', source,
         count(*), sum(case when ok = 0 then 1 else 0 end),
         coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
         coalesce(sum(cache_read_tokens),0), coalesce(sum(cache_write_tokens),0), coalesce(sum(cost),0)
  from requests group by (ts / 60000) * 60000, source;
  insert into rollup_token_day (day, token_remark, source, requests, errors, input, output, cache_read, cache_write, cost)
  select day, '默认', source,
         count(*), sum(case when ok = 0 then 1 else 0 end),
         coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
         coalesce(sum(cache_read_tokens),0), coalesce(sum(cache_write_tokens),0), coalesce(sum(cost),0)
  from requests group by day, source;
  `,
  // v6：输入拆成未缓存/缓存读取/缓存输入；只保留今天的数据用于验证
  `
  alter table requests rename column cache_write_tokens to cache_input_tokens;
  alter table requests rename column price_cache_write to price_cache_input;
  alter table requests add column uncached_input_tokens integer;
  update requests set uncached_input_tokens = max(0, input_tokens - cache_read_tokens - cache_input_tokens);

  alter table rollup_minute rename column cache_write to cache_input;
  alter table rollup_minute add column uncached integer not null default 0;
  update rollup_minute set uncached = max(0, input - cache_read - cache_input);
  alter table rollup_day rename column cache_write to cache_input;
  alter table rollup_day add column uncached integer not null default 0;
  update rollup_day set uncached = max(0, input - cache_read - cache_input);
  alter table rollup_token_minute rename column cache_write to cache_input;
  alter table rollup_token_minute add column uncached integer not null default 0;
  update rollup_token_minute set uncached = max(0, input - cache_read - cache_input);
  alter table rollup_token_day rename column cache_write to cache_input;
  alter table rollup_token_day add column uncached integer not null default 0;
  update rollup_token_day set uncached = max(0, input - cache_read - cache_input);

  delete from requests where day < '2026-11-14';
  delete from rollup_minute where minute < 1794585600000;
  delete from rollup_day where day < '2026-11-14';
  delete from rollup_token_minute where minute < 1794585600000;
  delete from rollup_token_day where day < '2026-11-14';
  delete from app_logs where ts < 1794585600000;
  `,
  // v7：记录上游是否上报缓存输入字段，未上报显示 —，与真实 0 区分
  `
  alter table requests add column cache_input_reported integer not null default 0;
  alter table rollup_minute add column cache_input_reported integer not null default 0;
  alter table rollup_day add column cache_input_reported integer not null default 0;
  alter table rollup_token_minute add column cache_input_reported integer not null default 0;
  alter table rollup_token_day add column cache_input_reported integer not null default 0;
  `,
  // v8：记录上游是否上报缓存读计数；渠道（如 GLM）把 details 置空时显示 — 而非误导性的 0.00%
  `
  alter table requests add column cache_read_reported integer not null default 0;
  alter table rollup_minute add column cache_read_reported integer not null default 0;
  alter table rollup_day add column cache_read_reported integer not null default 0;
  alter table rollup_token_minute add column cache_read_reported integer not null default 0;
  alter table rollup_token_day add column cache_read_reported integer not null default 0;
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function migrate(db: Db): void {
  const row = db.get<{ user_version: number }>('pragma user_version')
  const done = row?.user_version ?? 0
  for (let i = done; i < MIGRATIONS.length; i++) {
    db.tx(() => {
      db.exec(MIGRATIONS[i] as string)
    })
    db.exec(`pragma user_version = ${i + 1}`)
  }
  db.exec("insert or replace into schema_meta (key, value) values ('version', '" + String(SCHEMA_VERSION) + "')")
}

/** schema_meta 在 v1 之前不存在，单独建 */
export function ensureMeta(db: Db): void {
  db.exec('create table if not exists schema_meta (key text primary key, value text not null)')
}
