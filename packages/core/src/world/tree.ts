import type { WorldDefinition, WorldNode } from "@virtual-sim/shared";

/**
 * Environment tree: containment hierarchy of areas and objects.
 * Agents hold "known subtrees" — the set of node paths they have visited.
 */
export class WorldTree {
  private byPath = new Map<string, WorldNode>();

  constructor(public readonly def: WorldDefinition) {
    const walk = (n: WorldNode) => {
      this.byPath.set(n.path, n);
      for (const c of n.children) walk(c);
    };
    walk(def.tree);
  }

  get(path: string): WorldNode | undefined {
    return this.byPath.get(path);
  }

  /** All node paths (areas + objects). */
  paths(): string[] {
    return [...this.byPath.keys()];
  }

  childrenOf(path: string): WorldNode[] {
    return this.get(path)?.children ?? [];
  }

  /** Nearest ancestor (or self) that is an area — agents stand in areas. */
  areaOf(path: string): string {
    let p = path;
    while (p) {
      const n = this.get(p);
      if (n && n.kind === "area") return p;
      const idx = p.lastIndexOf(".");
      if (idx < 0) break;
      p = p.slice(0, idx);
    }
    return this.def.tree.path;
  }

  setObjectState(path: string, state: string | null): void {
    const n = this.get(path);
    if (n && n.kind === "object") n.state = state;
  }

  /** Natural-language description of an area and its objects, for prompts. */
  describeArea(areaPath: string): string {
    const n = this.get(areaPath);
    if (!n) return areaPath;
    const objects = n.children
      .filter((c) => c.kind === "object")
      .map((c) => (c.state ? `${c.name} (${c.state})` : c.name));
    return objects.length > 0 ? `${n.name} — contains: ${objects.join(", ")}` : n.name;
  }

  /** Anchor (tile position) for a node, falling back up the tree. */
  anchorOf(path: string): { x: number; y: number } {
    let p = path;
    while (p) {
      const a = this.def.anchors[p];
      if (a) return a;
      const idx = p.lastIndexOf(".");
      if (idx < 0) break;
      p = p.slice(0, idx);
    }
    return { x: 1, y: 1 };
  }
}
