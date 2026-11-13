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
