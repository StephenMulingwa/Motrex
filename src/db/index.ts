import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function connectionString(): string {
  const url = (process.env.MotrexDB ?? process.env.motrexneondb ?? "").trim();
  if (!url) {
    throw new Error("MotrexDB connection string is not set");
  }
  return url.replace(/^["']|["']$/g, "");
}

let _db: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(neon(connectionString()), { schema });
  }
  return _db;
}
