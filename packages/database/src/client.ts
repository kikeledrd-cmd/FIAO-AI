import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

loadEnv({ path: new URL("../../../.env", import.meta.url) });
loadEnv();

const DEVELOPMENT_DATABASE_URL = "postgresql://fiao:fiao_dev@localhost:5433/fiao_dev";

function databaseUrl(): string {
  const configured = process.env.DATABASE_URL;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL_REQUIRED");
  }
  return DEVELOPMENT_DATABASE_URL;
}

function createDatabaseClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl() });
  return new PrismaClient({ adapter });
}

const globalDatabase = globalThis as typeof globalThis & {
  __fiaoDatabaseClient?: PrismaClient;
};

export const databaseClient = globalDatabase.__fiaoDatabaseClient ?? createDatabaseClient();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.__fiaoDatabaseClient = databaseClient;
}

export type FiaoPrismaClient = PrismaClient;
