/** A* over the walkable tile grid. Used for office-view movement paths. */

export interface Point {
  x: number;
  y: number;
}

export function findPath(grid: number[][], from: Point, to: Point): Point[] {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const inBounds = (p: Point) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  const walkable = (p: Point) => inBounds(p) && grid[p.y]![p.x] === 0;
  const key = (p: Point) => p.y * w + p.x;

  if (!walkable(to)) {
    // Snap target to nearest walkable neighbor.
    const near = neighbors(to).find(walkable);
    if (!near) return [from];
    to = near;
  }
  if (!walkable(from)) return [to];

  const open = new Map<number, Point>([[key(from), from]]);
  const came = new Map<number, number>();
  const g = new Map<number, number>([[key(from), 0]]);
  const f = new Map<number, number>([[key(from), heuristic(from, to)]]);

  while (open.size > 0) {
    let curKey = -1;
    let curF = Infinity;
    for (const [k] of open) {
      const fk = f.get(k) ?? Infinity;
      if (fk < curF) {
        curF = fk;
        curKey = k;
      }
    }
    const current = open.get(curKey)!;
    if (current.x === to.x && current.y === to.y) {
      return reconstruct(came, curKey, w);
    }
    open.delete(curKey);
    for (const nb of neighbors(current)) {
      if (!walkable(nb)) continue;
      const nbKey = key(nb);
      const tentative = (g.get(curKey) ?? Infinity) + 1;
      if (tentative < (g.get(nbKey) ?? Infinity)) {
        came.set(nbKey, curKey);
        g.set(nbKey, tentative);
        f.set(nbKey, tentative + heuristic(nb, to));
        if (!open.has(nbKey)) open.set(nbKey, nb);
      }
    }
  }
  return [from]; // unreachable: stay put
}

function neighbors(p: Point): Point[] {
  return [
    { x: p.x + 1, y: p.y },
    { x: p.x - 1, y: p.y },
    { x: p.x, y: p.y + 1 },
    { x: p.x, y: p.y - 1 },
  ];
}

function heuristic(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstruct(came: Map<number, number>, end: number, w: number): Point[] {
  const path: Point[] = [];
  let cur: number | undefined = end;
  while (cur !== undefined) {
    path.unshift({ x: cur % w, y: Math.floor(cur / w) });
    cur = came.get(cur);
  }
  return path;
}
