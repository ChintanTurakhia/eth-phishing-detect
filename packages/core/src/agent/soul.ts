import matter from "gray-matter";
import { z } from "zod";
import type { Soul } from "@virtual-sim/shared";

const frontmatterZ = z.object({
  name: z.string().min(1),
  role: z.enum(["engineer", "pm", "designer"]),
  team: z.string().default("Core"),
  desk: z.string().min(1),
  avatar: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  wakeHour: z.number().int().min(0).max(23).default(8),
  sleepHour: z.number().int().min(1).max(24).default(19),
});

const SECTIONS = [
  "Identity",
  "Personality",
  "Expertise",
  "Values",
  "Quirks",
  "Relationships",
] as const;

/** Parse a soul.md file into a Soul. Throws with a readable message on invalid input. */
export function parseSoul(path: string, raw: string): Soul {
  const { data, content } = matter(raw);
  const fm = frontmatterZ.parse(data);

  const sections: Record<string, string> = {};
  let current: string | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (current) sections[current] = buf.join("\n").trim();
    buf.length = 0;
  };
  for (const line of content.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      current = m[1]!;
    } else if (current) {
      buf.push(line);
    }
  }
  flush();

  for (const required of ["Identity", "Personality", "Expertise", "Values"]) {
    if (!sections[required]) {
      throw new Error(`soul file ${path}: missing required section "# ${required}"`);
    }
  }

  return {
    ...fm,
    path,
    identity: sections["Identity"] ?? "",
    personality: sections["Personality"] ?? "",
    expertise: sections["Expertise"] ?? "",
    values: sections["Values"] ?? "",
    quirks: sections["Quirks"] ?? "",
    relationships: sections["Relationships"] ?? "",
  };
}

/**
 * Compile the soul into the agent's summary description — the stable,
 * cacheable identity block used in every cognition prompt.
 */
export function compileSummaryDescription(soul: Soul): string {
  const parts = [
    `Name: ${soul.name}`,
    `Role: ${soul.role === "pm" ? "Product Manager" : soul.role === "engineer" ? "Engineer" : "Designer"} on the ${soul.team} team`,
    ``,
    `Identity: ${soul.identity}`,
    ``,
    `Personality: ${soul.personality}`,
    ``,
    `Expertise: ${soul.expertise}`,
    ``,
    `Values: ${soul.values}`,
  ];
  if (soul.quirks) parts.push(``, `Quirks: ${soul.quirks}`);
  if (soul.relationships) parts.push(``, `Relationships: ${soul.relationships}`);
  return parts.join("\n");
}

export { SECTIONS as SOUL_SECTIONS };
