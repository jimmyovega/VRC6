import { describe, expect, it } from "vitest";
import { getMaintenanceStatus } from "../../src/lib/maintenance";

// A minimal drizzle-shaped fake whose final chained call throws — simulates
// a D1 internal error without needing a real D1 binding (the integration
// test in test/integration/maintenance.test.ts already covers the
// real-D1/happy-path behavior).
function throwingDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            throw new Error("D1_ERROR: internal error; reference = fake");
          },
        }),
      }),
    }),
  } as never;
}

describe("getMaintenanceStatus", () => {
  it("fails open (maintenance off) instead of throwing when the D1 query itself fails", async () => {
    // This gate runs on every anonymous request to every path — a thrown
    // error here would 500 the entire public site over a transient D1 blip
    // unrelated to maintenance mode. See the reasoning on the catch block.
    await expect(getMaintenanceStatus(throwingDb())).resolves.toEqual({
      enabled: false,
      message: null,
    });
  });
});
