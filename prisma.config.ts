import "dotenv/config";
import { defineConfig } from "prisma/config";

const developmentDatabaseUrl = "postgresql://fiao:fiao_dev@localhost:5433/fiao_dev";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts"
  },
  datasource: {
    url: process.env.DATABASE_URL ?? developmentDatabaseUrl
  }
});
