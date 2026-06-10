import type { WorldAnchor, WorldDefinition, WorldNode } from "@virtual-sim/shared";

/** Friendly on-disk world format (worlds/office.json). */
export interface FriendlyWorld {
  name: string;
  tileSize: number;
  /** Row strings of '0' (floor) / '1' (wall). */
  rows: string[];
  areas: Record<
    string,
    {
      label: string;
      anchor: WorldAnchor;
      objects?: Record<string, { label: string; anchor: WorldAnchor }>;
    }
  >;
}

export function loadWorld(friendly: FriendlyWorld): WorldDefinition {
  const grid = friendly.rows.map((row) => [...row].map((c) => (c === "1" ? 1 : 0)));
  const width = grid[0]?.length ?? 0;
  for (const row of grid) {
    if (row.length !== width) throw new Error(`world ${friendly.name}: ragged tile rows`);
  }

  const anchors: Record<string, WorldAnchor> = {};
  const areaNodes: WorldNode[] = [];

  for (const [areaKey, area] of Object.entries(friendly.areas)) {
    const areaPath = `${friendly.name}.${areaKey}`;
    anchors[areaPath] = area.anchor;
    const children: WorldNode[] = [];
    for (const [objKey, obj] of Object.entries(area.objects ?? {})) {
      const objPath = `${areaPath}.${objKey}`;
      anchors[objPath] = obj.anchor;
      children.push({ path: objPath, name: obj.label, kind: "object", state: null, children: [] });
    }
    areaNodes.push({ path: areaPath, name: area.label, kind: "area", state: null, children });
  }

  return {
    name: friendly.name,
    tilemap: { width, height: grid.length, tileSize: friendly.tileSize, grid },
    tree: {
      path: friendly.name,
      name: `the ${friendly.name}`,
      kind: "area",
      state: null,
      children: areaNodes,
    },
    anchors,
  };
}
