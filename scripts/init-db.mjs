import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required");
}

const sql = neon(databaseUrl);
await sql`
  CREATE TABLE IF NOT EXISTS app_state (
    id smallint PRIMARY KEY CHECK (id = 1),
    data jsonb,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT app_state_data_is_object
      CHECK (data IS NULL OR jsonb_typeof(data) = 'object')
  )
`;
await sql`
  INSERT INTO app_state (id, data, revision)
  VALUES (1, NULL, 0)
  ON CONFLICT (id) DO NOTHING
`;
await sql`
  CREATE TABLE IF NOT EXISTS app_state_revisions (
    revision bigint PRIMARY KEY CHECK (revision >= 0),
    data jsonb,
    previous_updated_at timestamptz NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT NOW(),
    action text NOT NULL DEFAULT 'state_update',
    CONSTRAINT app_state_revisions_data_is_object
      CHECK (data IS NULL OR jsonb_typeof(data) = 'object')
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS login_rate_limits (
    key_hash text PRIMARY KEY,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    window_started_at timestamptz NOT NULL DEFAULT NOW(),
    blocked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT NOW()
  )
`;

console.log("Neon schema is ready.");
