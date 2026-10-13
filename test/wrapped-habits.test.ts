import { beforeEach, describe, expect, test } from "bun:test";
import { wrappedHabits } from "../src/tools/lib/wrapped/habits";
import { habitsLines } from "../src/tools/lib/wrapped/render";
import { budapestHome, event } from "./lib/wrapped-events";

beforeEach(() => {
  budapestHome(import.meta.file);
});

const commitAt = (ts: string) => event("commit", {}, { ts });

describe("habits", () => {
  test("nothing logged shows no habit", () => {
    expect(wrappedHabits([])).toEqual({
      mostActiveHour: null,
      mostActiveWeekday: null,
      mostActiveMonth: null,
      nightShare: null,
      weekendShare: null,
      channels: [],
      skimRate: null,
      correctionRate: null,
    });
  });

  test("the most active hour counts days, not how busy each hour was", () => {
    const habits = wrappedHabits([
      ...[1, 2, 3, 4, 5].map((m) => commitAt(`2026-03-02T08:0${m}:00.000Z`)),
      commitAt("2026-03-03T13:00:00.000Z"),
      commitAt("2026-03-04T13:00:00.000Z"),
    ]);
    expect(habits.mostActiveHour).toEqual({ value: 2, label: "14:00" });
  });

  test("an hour tie goes to the earlier hour", () => {
    const habits = wrappedHabits([
      commitAt("2026-03-02T15:00:00.000Z"),
      commitAt("2026-03-02T08:00:00.000Z"),
    ]);
    expect(habits.mostActiveHour?.label).toBe("09:00");
  });

  test("the busiest weekday and month count active hours, not how busy each was", () => {
    const habits = wrappedHabits([
      ...[1, 2, 3, 4, 5].map((m) => commitAt(`2026-03-02T08:0${m}:00.000Z`)),
      commitAt("2026-04-07T08:00:00.000Z"),
      commitAt("2026-04-07T09:00:00.000Z"),
      commitAt("2026-04-30T21:59:00.000Z"),
      commitAt("2026-04-30T22:00:00.000Z"),
    ]);
    expect(habits.mostActiveWeekday).toEqual({ value: 2, label: "Tue" });
    expect(habits.mostActiveMonth).toEqual({ value: 3, label: "2026-04" });
  });

  test("a month tie goes to the earlier month", () => {
    const habits = wrappedHabits([
      commitAt("2026-05-04T08:00:00.000Z"),
      commitAt("2026-03-02T08:00:00.000Z"),
    ]);
    expect(habits.mostActiveMonth?.label).toBe("2026-03");
  });

  test("night is 22:00 to 06:00 local and weekends are Saturday and Sunday", () => {
    const habits = wrappedHabits([
      commitAt("2026-03-02T21:00:00.000Z"),
      commitAt("2026-03-02T04:59:00.000Z"),
      commitAt("2026-03-02T05:00:00.000Z"),
      commitAt("2026-03-02T20:59:00.000Z"),
      commitAt("2026-03-07T10:00:00.000Z"),
      commitAt("2026-03-08T10:00:00.000Z"),
      commitAt("2026-03-09T10:00:00.000Z"),
      commitAt("2026-03-06T10:00:00.000Z"),
    ]);
    expect(habits.nightShare).toBe(2 / 8);
    expect(habits.weekendShare).toBe(2 / 8);
  });

  test("PAL's own spawned calls and other events are not the user's hours", () => {
    const habits = wrappedHabits([
      commitAt("2026-03-02T08:00:00.000Z"),
      event("model_call", { entrypoint: "sdk-cli" }, { ts: "2026-03-07T22:00:00.000Z" }),
      event("rating", {}, { ts: "2026-03-07T23:00:00.000Z" }),
    ]);
    expect(habits.nightShare).toBe(0);
    expect(habits.weekendShare).toBe(0);
  });

  test("messages are split by channel, a terminal turn has none, most used first", () => {
    const habits = wrappedHabits([
      event("turn", {}, { channel: "discord-mobile" }),
      event("turn"),
      event("turn", {}, { channel: "discord-desktop" }),
      event("turn", {}, { channel: "discord-mobile" }),
      event("turn", {}, { channel: "discord-web" }),
      event("commit", {}, { channel: "discord-web" }),
    ]);
    expect(habits.channels).toEqual([
      { name: "discord-mobile", count: 2 },
      { name: "discord-desktop", count: 1 },
      { name: "discord-web", count: 1 },
      { name: "terminal", count: 1 },
    ]);
  });

  test("the skim rate is over turns that answered a reply; corrections over all turns", () => {
    const reply = { words: 100 };
    const habits = wrappedHabits([
      event("turn", { reply, skimmed: true }),
      event("turn", { reply, skimmed: false, corrected: true }),
      event("turn", { reply }),
      event("turn", { reply }),
      event("turn", { reply, skimmed: true }),
      event("turn", { reply: null, skimmed: true }),
      event("turn", { skimmed: true }),
    ]);
    expect(habits.skimRate).toBe(2 / 5);
    expect(habits.correctionRate).toBe(1 / 7);
  });
});

describe("the habits as printed", () => {
  test("shares print as whole percentages and unknowns say so", () => {
    expect(
      habitsLines({
        mostActiveHour: { value: 90, label: "21:00" },
        mostActiveWeekday: { value: 1, label: "Tue" },
        mostActiveMonth: { value: 1239, label: "2026-09" },
        nightShare: 0.064,
        weekendShare: null,
        channels: [
          { name: "discord-desktop", count: 1276 },
          { name: "terminal", count: 3 },
        ],
        skimRate: 0.015,
        correctionRate: 0,
      })
    ).toEqual([
      "\n  Habits\n",
      "    most active hour     21:00  (active on 90 days)",
      "    most active weekday  Tue  (1 active hour)",
      "    most active month    2026-09  (1,239 active hours)",
      "    at night (22-06)     6%",
      "    on weekends          unknown",
      "    messages by channel  discord-desktop 1,276 · terminal 3",
      "    skimmed replies      2%",
      "    corrections          0%",
    ]);
  });

  test("with no turns or activity every habit is unknown", () => {
    expect(
      habitsLines({
        mostActiveHour: null,
        mostActiveWeekday: null,
        mostActiveMonth: null,
        nightShare: null,
        weekendShare: null,
        channels: [],
        skimRate: null,
        correctionRate: null,
      }).slice(1)
    ).toEqual([
      "    most active hour     unknown",
      "    most active weekday  unknown",
      "    most active month    unknown",
      "    at night (22-06)     unknown",
      "    on weekends          unknown",
      "    messages by channel  unknown",
      "    skimmed replies      unknown",
      "    corrections          unknown",
    ]);
  });
});
