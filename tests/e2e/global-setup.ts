import { resetTestDatabase } from "./test-database";

export default async function globalSetup() {
  await resetTestDatabase();
}
