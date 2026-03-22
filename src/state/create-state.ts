import { InMemoryState } from "./in-memory-state.js";
import { PostgresRedisState } from "./postgres-redis-state.js";
import type { StateStore } from "./state-store.js";

export const createStateFromEnv = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<StateStore> => {
  const databaseUrl = env.DATABASE_URL;
  const redisUrl = env.REDIS_URL;
  if (databaseUrl && redisUrl) {
    return PostgresRedisState.create({
      databaseUrl,
      redisUrl,
      redisToken: env.REDIS_TOKEN,
    });
  }
  return new InMemoryState();
};

