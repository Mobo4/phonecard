import { describe, expect, it } from "vitest";
import { createStateFromEnv } from "../src/state/create-state.js";
import { InMemoryState } from "../src/state/in-memory-state.js";

describe("state factory", () => {
  it("falls back to in-memory when persistent env vars are absent", async () => {
    const state = await createStateFromEnv({});
    expect(state).toBeInstanceOf(InMemoryState);
  });
});

