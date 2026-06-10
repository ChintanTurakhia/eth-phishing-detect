import { describe, expect, it } from "vitest";
import { findPath } from "../src/world/nav.js";

// 0 = floor, 1 = wall
const grid = [
  [0, 0, 0, 0, 0],
  [0, 1, 1, 1, 0],
  [0, 0, 0, 1, 0],
  [1, 1, 0, 1, 0],
  [0, 0, 0, 0, 0],
];

describe("findPath", () => {
  it("finds a path around walls", () => {
    const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 });
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 4, y: 4 });
    // Every step is a single orthogonal move onto floor.
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
      expect(grid[b.y]![b.x]).toBe(0);
    }
  });

  it("stays put when the target is unreachable", () => {
    const sealed = [
      [0, 1, 0],
      [1, 1, 0],
      [0, 0, 0],
    ];
    const path = findPath(sealed, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toEqual([{ x: 0, y: 0 }]);
  });

  it("snaps a blocked target to a walkable neighbor", () => {
    const path = findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 });
    const end = path[path.length - 1]!;
    expect(grid[end.y]![end.x]).toBe(0);
  });
});
