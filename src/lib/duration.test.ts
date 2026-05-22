import { describe, expect, it } from "vitest";

import { formatMinutes, parseISODuration, formatDuration } from "./duration";

describe("parseISODuration", () => {
  it("parses PT2H15M to 135", () => {
    expect(parseISODuration("PT2H15M")).toBe(135);
  });
  it("parses PT45M to 45", () => {
    expect(parseISODuration("PT45M")).toBe(45);
  });
  it("parses PT6H to 360", () => {
    expect(parseISODuration("PT6H")).toBe(360);
  });
  it("parses PT0M to 0", () => {
    expect(parseISODuration("PT0M")).toBe(0);
  });
  it("returns 0 for invalid input", () => {
    expect(parseISODuration("")).toBe(0);
    expect(parseISODuration("garbage")).toBe(0);
    expect(parseISODuration("PT")).toBe(0);
  });
});

describe("formatMinutes", () => {
  it("formats 135 to '2h 15min' (fr)", () => {
    expect(formatMinutes(135, "fr")).toBe("2h 15min");
  });
  it("formats 135 to '2h 15min' (en)", () => {
    expect(formatMinutes(135, "en")).toBe("2h 15min");
  });
  it("formats 60 to '1h' when minutes==0", () => {
    expect(formatMinutes(60, "fr")).toBe("1h");
  });
  it("formats 45 to '45 min' (fr)", () => {
    expect(formatMinutes(45, "fr")).toBe("45 min");
  });
  it("formats 45 to '45min' (en)", () => {
    expect(formatMinutes(45, "en")).toBe("45min");
  });
  it("returns empty string for 0 or negative", () => {
    expect(formatMinutes(0, "fr")).toBe("");
    expect(formatMinutes(-5, "fr")).toBe("");
  });
});

describe("formatDuration", () => {
  it("formats ISO directly to '2h 15min'", () => {
    expect(formatDuration("PT2H15M", "fr")).toBe("2h 15min");
  });
  it("returns empty string for invalid ISO", () => {
    expect(formatDuration("", "fr")).toBe("");
  });
});
