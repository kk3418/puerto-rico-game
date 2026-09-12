import { describe, expect, it } from "vitest";
import { classifySeq } from "./seq";

describe("classifySeq", () => {
  it("treats seq 1 as next when the match has no events", () => {
    expect(classifySeq(1, 0)).toBe("next");
  });

  it("ignores already stored seq values", () => {
    expect(classifySeq(3, 5)).toBe("duplicate");
    expect(classifySeq(5, 5)).toBe("duplicate");
  });

  it("rejects gaps so replay stays contiguous", () => {
    expect(classifySeq(7, 5)).toBe("gap");
  });
});
