import { SqliteStore } from "./store.js";
import { SCHEMA } from "./schema.js";

const path = process.env.DATABASE_PATH ?? "./data/sim.db";
new SqliteStore(path, SCHEMA);
console.log(`migrated ${path}`);
