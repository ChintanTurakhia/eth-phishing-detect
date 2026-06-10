import { locationChoiceJsonSchema, locationChoiceZ } from "@virtual-sim/shared";
import type { LlmPort, LlmSystemBlock } from "../ports.js";
import type { WorldTree } from "../world/tree.js";
import { locatePrompt } from "./prompts.js";
import { PRIORITY } from "../sim/scheduler.js";

export interface LocateDeps {
  llm: LlmPort;
  system: LlmSystemBlock[];
  world: WorldTree;
}

/**
 * Resolve an action to a concrete world path by recursively descending the
 * tree with LLM choices (paper's recursive traversal). Fast paths avoid LLM
 * calls when the hint already names a node.
 */
export async function resolveLocation(
  deps: LocateDeps,
  args: { currentArea: string; action: string; locationHint: string | null },
): Promise<string> {
  // Fast path: hint matches a node path or name directly.
  if (args.locationHint) {
    const hint = args.locationHint.toLowerCase().trim();
    for (const path of deps.world.paths()) {
      const node = deps.world.get(path)!;
      if (path.toLowerCase() === hint || node.name.toLowerCase() === hint) {
        return deps.world.areaOf(path);
      }
    }
    // Substring match on names (e.g. "whiteboard in the war room").
    for (const path of deps.world.paths()) {
      const node = deps.world.get(path)!;
      if (hint.includes(node.name.toLowerCase()) && node.name.length > 3) {
        return deps.world.areaOf(path);
      }
    }
  }

  // Recursive LLM descent from the root.
  let current = deps.world.def.tree.path;
  for (let depth = 0; depth < 4; depth++) {
    const children = deps.world.childrenOf(current).filter((c) => c.kind === "area");
    if (children.length === 0) break;
    if (children.length === 1) {
      current = children[0]!.path;
      continue;
    }
    const res = await deps.llm.call({
      tier: "utility",
      purpose: "locate",
      system: deps.system,
      user: locatePrompt({
        currentArea: deps.world.get(args.currentArea)?.name ?? args.currentArea,
        action: args.action,
        options: children.map((c) => ({
          name: c.name,
          description: deps.world.describeArea(c.path),
        })),
      }),
      jsonSchema: locationChoiceJsonSchema,
      maxTokens: 100,
      priority: PRIORITY.plan,
    });
    const choice = locationChoiceZ.parse(JSON.parse(res.text)).choice.toLowerCase();
    const picked =
      children.find((c) => c.name.toLowerCase() === choice) ??
      children.find((c) => choice.includes(c.name.toLowerCase()));
    if (!picked) break;
    current = picked.path;
  }
  return deps.world.areaOf(current);
}
