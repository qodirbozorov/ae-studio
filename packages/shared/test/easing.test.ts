import { describe, expect, it } from "vitest";
import {
  EASE_TOKENS,
  bezierEase,
  easeCurveSchema,
  pathLength,
  rawEase,
  resolveCurve,
  valueDeltas,
} from "../src/index";
import type { Bezier } from "../src/index";

const near = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 2);

describe("easing (P6.03, §11-A/B)", () => {
  it("tokenlar jadvalga mos: Δv/T = o'rtacha tezlik", () => {
    // Δv = 100, T = 1 → avg = 100.
    const enter = bezierEase(EASE_TOKENS.enter!, [100], 1);
    near(enter.out[0]!.speed, 625);
    near(enter.out[0]!.influence, 16);
    near(enter.in[0]!.speed, 0);
    near(enter.in[0]!.influence, 70);

    const exit = bezierEase(EASE_TOKENS.exit!, [100], 1);
    near(exit.out[0]!.speed, 0);
    near(exit.out[0]!.influence, 70);
    near(exit.in[0]!.speed, 625);
    near(exit.in[0]!.influence, 16);

    const move = bezierEase(EASE_TOKENS.move!, [100], 1);
    expect([move.out[0]!.speed, move.in[0]!.speed]).toEqual([0, 0]);
    near(move.out[0]!.influence, 65);
    near(move.in[0]!.influence, 65);

    const soft = bezierEase(EASE_TOKENS.soft!, [100], 1);
    near(soft.out[0]!.influence, 33.3);
    near(soft.in[0]!.influence, 33.3);

    const pop = bezierEase(EASE_TOKENS.pop!, [100], 1);
    near(pop.out[0]!.speed, 458.82);
    near(pop.out[0]!.influence, 34);
    near(pop.in[0]!.speed, 0);
    near(pop.in[0]!.influence, 36);
  });

  it("ishora Δv ga teng, ko'p o'lchamda har o'lcham alohida, rang 0, T=0 → 0", () => {
    const down = bezierEase(EASE_TOKENS.enter!, [-50, 200], 2);
    near(down.out[0]!.speed, -156.25);
    near(down.out[1]!.speed, 625);
    expect(bezierEase(EASE_TOKENS.enter!, [1], 1, true).out[0]!.speed).toBe(0);
    expect(bezierEase(EASE_TOKENS.enter!, [100], 0).out[0]!.speed).toBe(0);
  });

  it("influence 0.1–100 oralig'ida (x1 = 0 yoki x2 = 1)", () => {
    const edge = bezierEase([0, 0, 1, 1] as Bezier, [10], 1);
    expect(edge.out[0]).toEqual({ speed: 0, influence: 0.1 });
    expect(edge.in[0]).toEqual({ speed: 0, influence: 0.1 });
  });

  it("resolveCurve: token ($ bilan ham), bezier, linear/hold, xom, noto'g'ri", () => {
    expect(resolveCurve("$pop")).toEqual({ kind: "bezier", bezier: EASE_TOKENS.pop });
    expect(resolveCurve("enter")).toEqual({ kind: "bezier", bezier: EASE_TOKENS.enter });
    expect(resolveCurve([0.4, 0, 0.2, 1])).toEqual({ kind: "bezier", bezier: [0.4, 0, 0.2, 1] });
    expect(resolveCurve("linear")).toEqual({ kind: "linear" });
    expect(resolveCurve("hold")).toEqual({ kind: "hold" });
    expect(resolveCurve({ in: [0, 75], out: [0, 30] })).toMatchObject({ kind: "raw" });
    expect(resolveCurve("bouncy")).toBeNull();
    expect(resolveCurve([1.2, 0, 0.2, 1])).toBeNull();
    expect(resolveCurve([0.1, 0, 0.2])).toBeNull();
    expect(resolveCurve({ in: [0] })).toBeNull();
  });

  it("rawEase, valueDeltas, pathLength", () => {
    expect(rawEase({ in: [0, 200], out: [5, 0] }, 2).out).toEqual([
      { speed: 5, influence: 0.1 },
      { speed: 5, influence: 0.1 },
    ]);
    expect(rawEase({ in: [0, 200], out: [5, 0] }, 1).in[0]!.influence).toBe(100);
    expect(valueDeltas(10, 25)).toEqual([15]);
    expect(valueDeltas([0, 0, 5], [3, 4])).toEqual([3, 4]);
    expect(pathLength([0, 0], [3, 4])).toBe(5);
  });

  it("easeCurveSchema: op parametrlari", () => {
    for (const ok of ["enter", "$pop", "hold", [0.16, 1, 0.3, 1], { in: [0, 33], out: [0, 33] }]) {
      expect(easeCurveSchema.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
    }
    for (const bad of ["ease_in", "$linear", [2, 0, 0, 1], { in: [0, 0], out: [0, 33] }]) {
      expect(easeCurveSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
