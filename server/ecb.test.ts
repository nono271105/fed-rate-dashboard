import { describe, expect, it } from "vitest";
import { ecbTest } from "./ecb";

describe("ECB market parsing", () => {
  it("keeps the latest occurrence when a provider repeats historical and forward rows", () => {
    const meetingDate = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000));
    const html = `${meetingDate} 2.02% 3.6% 0.07 1.7 ${meetingDate} 2.69% 74.8% 0.75 18.7`;
    const meetings = ecbTest.parseMarketMeetings(html, 2.5);
    expect(meetings).toHaveLength(1);
    expect(meetings[0]?.impliedRate).toBe(2.69);
    expect(meetings[0]?.moveProbability).toBe(74.8);
    expect(meetings[0]?.scenarios[0]?.moveBps).toBe(25);
  });

  it("omits expired meetings from fallback data", () => {
    const snapshot = ecbTest.fallbackSnapshot();
    expect(snapshot.meetings.every((meeting) => meeting.date >= snapshot.asOfDate)).toBe(true);
  });
});
