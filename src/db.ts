// src/db.ts
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
  return pool.query(text, params);
}

export async function initDb() {
  await query(`create extension if not exists pgcrypto;`);
  await query(`
    create table if not exists runs (
      id uuid default gen_random_uuid() primary key,
      status text not null,
      inputs jsonb not null,
      outputs jsonb,
      org_id text default 'demo',
      user_id text default 'demo',
      created_at timestamptz default now()
    );
  `);
  await query(`
    create table if not exists feedback (
      id uuid default gen_random_uuid() primary key,
      run_id uuid references runs(id) on delete cascade,
      target text not null,
      dimension text not null,
      score int not null,
      note text,
      org_id text default 'demo',
      created_at timestamptz default now()
    );
  `);
  await query(`
    create table if not exists style_memories (
      id uuid default gen_random_uuid() primary key,
      org_id text not null,
      key text not null,
      value jsonb not null,
      weight float default 1,
      updated_at timestamptz default now()
    );
  `);
}
