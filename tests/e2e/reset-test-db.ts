import { resetTestDatabase } from "./test-database";

resetTestDatabase().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
