import { describe, expect, it } from "vitest";

import { classifyLayover, layoverClassName } from "./layover";

describe("classifyLayover", () => {
  it("classifies <60min as tight", () => {
    expect(classifyLayover("PT45M")).toBe("tight");
    expect(classifyLayover("PT59M")).toBe("tight");
  });
  it("classifies 60min as normal (boundary)", () => {
    expect(classifyLayover("PT60M")).toBe("normal");
    expect(classifyLayover("PT1H")).toBe("normal");
  });
  it("classifies 1-5h as normal", () => {
    expect(classifyLayover("PT2H15M")).toBe("normal");
    expect(classifyLayover("PT4H30M")).toBe("normal");
  });
  it("classifies 300min as normal (boundary)", () => {
    expect(classifyLayover("PT5H")).toBe("normal");
    expect(classifyLayover("PT300M")).toBe("normal");
  });
  it("classifies >5h as long", () => {
    expect(classifyLayover("PT5H1M")).toBe("long");
    expect(classifyLayover("PT6H30M")).toBe("long");
  });
});

describe("layoverClassName", () => {
  it("returns a warning-orange Tailwind class for tight + long", () => {
    expect(layoverClassName("tight")).toContain("orange");
    expect(layoverClassName("long")).toContain("orange");
  });
  it("returns a neutral gray class for normal", () => {
    expect(layoverClassName("normal")).toContain("gray");
  });
});
