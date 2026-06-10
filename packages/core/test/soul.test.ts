import { describe, expect, it } from "vitest";
import { compileSummaryDescription, parseSoul } from "../src/agent/soul.js";

const SOUL = `---
name: Ada Lovelace
role: engineer
team: Platform
desk: office.bullpen.desk-ada
avatar: ada
color: "#7c5cff"
wakeHour: 8
sleepHour: 19
---

# Identity
Staff engineer with a decade of distributed-systems work.

# Personality
- Direct, skeptical of hype
- Generous code reviewer

# Expertise
TypeScript, API design, performance.

# Values
Ship small, measure everything.

# Quirks
Whiteboards before code.

# Relationships
- grace: trusts her prioritization
`;

describe("parseSoul", () => {
  it("parses frontmatter and sections", () => {
    const soul = parseSoul("ada.soul.md", SOUL);
    expect(soul.name).toBe("Ada Lovelace");
    expect(soul.role).toBe("engineer");
    expect(soul.wakeHour).toBe(8);
    expect(soul.identity).toContain("Staff engineer");
    expect(soul.personality).toContain("skeptical of hype");
    expect(soul.relationships).toContain("grace");
  });

  it("rejects a soul missing a required section", () => {
    const broken = SOUL.replace("# Values", "# NotValues");
    expect(() => parseSoul("x.soul.md", broken)).toThrow(/Values/);
  });

  it("rejects invalid frontmatter", () => {
    const broken = SOUL.replace('color: "#7c5cff"', 'color: "purple"');
    expect(() => parseSoul("x.soul.md", broken)).toThrow();
  });
});

describe("compileSummaryDescription", () => {
  it("includes the identity sections used by prompts", () => {
    const summary = compileSummaryDescription(parseSoul("ada.soul.md", SOUL));
    expect(summary).toContain("Name: Ada Lovelace");
    expect(summary).toContain("Engineer on the Platform team");
    expect(summary).toContain("Ship small");
    expect(summary).toContain("Whiteboards before code");
  });
});
