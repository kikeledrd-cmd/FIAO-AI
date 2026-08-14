import "dotenv/config";
import { defineConfig } from "prisma/config";

const developmentDatabaseUrl = "postgresql://fiao:fiao_dev@localhost:5432/fiao_dev";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env.DATABASE_URL ?? developmentDatabaseUrl
  }
});
