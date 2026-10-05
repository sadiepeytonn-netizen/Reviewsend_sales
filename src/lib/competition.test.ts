import { describe, expect, it } from "vitest";
import { callPoints, competitionWeek, emptyTally, rank, totalPoints } from "./competition";

describe("competition scoring", () => {
  it("gives talk points only on real conversations, capped per call", () => {
    expect(callPoints("not_interested", 250)).toEqual({ contact: 1, talk: 2 });
    expect(callPoints("appointment_set", 60 * 60)).toEqual({ contact: 1, talk: 10 });
    expect(callPoints("no_answer", 900)).toEqual({ contact: 0, talk: 0 }); // voicemail
    expect(callPoints("bad_number", 900)).toEqual({ contact: 0, talk: 0 });
    expect(callPoints(null, 900)).toEqual({ contact: 0, talk: 0 });
  });

  it("adds up the example day from the plan", () => {
    const t = { ...emptyTally(), contacts: 40, talkPoints: 40, appointments: 3, sales: 1 };
    expect(totalPoints(t)).toBe(160);
  });

  it("runs Monday to Monday in Eastern time, weekends included", () => {
    // Sunday Oct 11 2026, 11pm Eastern = still the week of Oct 5
    const w = competitionWeek(new Date("2026-10-12T03:00:00Z"));
    expect(w.from.toISOString()).toBe("2026-10-05T04:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-10-12T04:00:00.000Z");
    expect(w.label).toBe("Oct 5 – Oct 11");
    // Monday 12:30am Eastern starts a new week
    expect(competitionWeek(new Date("2026-10-12T04:30:00Z")).from.toISOString()).toBe("2026-10-12T04:00:00.000Z");
  });

  it("ranks with shared places for ties", () => {
    const r = rank([{ points: 5 }, { points: 9 }, { points: 9 }, { points: 1 }]);
    expect(r.map((x) => [x.points, x.place])).toEqual([[9, 1], [9, 1], [5, 3], [1, 4]]);
  });
});
