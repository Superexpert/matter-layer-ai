import { expect, test } from "@playwright/test";

import { assertTestDatabaseUrl } from "./test-database";

test("test database safety guard rejects non-test database urls", () => {
  expect(() =>
    assertTestDatabaseUrl("postgresql://matter:layer@localhost:5432/matter_layer_dev"),
  ).toThrow(/non-test database/);
});

test("test database safety guard accepts test database urls", () => {
  expect(() =>
    assertTestDatabaseUrl("postgresql://matter:layer@localhost:5432/matter_layer_test"),
  ).not.toThrow();
});
