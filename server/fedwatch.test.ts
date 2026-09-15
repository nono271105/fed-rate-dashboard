import { describe, expect, it } from "vitest";
import { calculateMeetings, makeScenarios } from "./fedwatch";

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
});
