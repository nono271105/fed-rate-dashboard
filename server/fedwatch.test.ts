import { describe, expect, it } from "vitest";
import { calculateMeetings, fedTest, makeScenarios } from "./fedwatch";

describe("FedWatch calculation engine", () => {
  it("converts a 17bp expected move into 68% hike probability", () => {
    const scenarios = makeScenarios(3.63, 3.80, 3.5);
    expect(scenarios).toEqual([
      expect.objectContaining({ moveBps: 0, probability: 32 }),
      expect.objectContaining({ moveBps: 25, probability: 68 }),
    ]);
  });

  it("calculates the post-meeting rate from a monthly settlement", () => {
    const meetings = calculateMeetings(
      [
        { month: "AUG 26", settle: 96.37 },
        { month: "SEP 26", settle: 96.29 },
      ],
      ["2026-09-16"],
      3.63,
      3.5,
    );
    expect(meetings).toHaveLength(1);
    expect(meetings[0]?.impliedMonthlyRate).toBe(3.71);
    expect(meetings[0]?.postRate).toBeCloseTo(3.79, 2);
    expect(meetings[0]?.scenarios.find((scenario) => scenario.moveBps > 0)?.probability).toBe(64);
  });

  it("uses the most recent numeric FRED observation", () => {
    expect(fedTest.latestFredValue([{ value: "." }, { value: "3.625" }, { value: "3.5" }])).toBe(3.625);
  });

  it("reads official settlements and skips intraday bars without one", () => {
    expect(fedTest.latestSettlement([{ close: 95.92 }, { settlement_price: 95.925 }])).toBe(95.925);
    expect(fedTest.latestSettlement([{ close: 95.92 }])).toBeNull();
  });

  it("requests only the futures months needed to price selected meetings", () => {
    expect(fedTest.settlementMonths(["2026-09-16", "2026-12-09"])).toEqual([
      "SEP 26",
      "AUG 26",
      "DEC 26",
      "NOV 26",
    ]);
  });
});
