import { resetTestDatabase } from "../support/test-database";

export default async function globalSetup() {
  await resetTestDatabase();
}
