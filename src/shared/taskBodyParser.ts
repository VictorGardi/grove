import type { DodItem } from "./types";

export interface TaskBody {
  description: string;
  dod: DodItem[];
  contextForAgent: string;
  otherSections: { heading: string; content: string }[];
}

/** Known section headings (case-insensitive matching) */
const DESCRIPTION_HEADINGS = ["description"];
const DOD_HEADINGS = ["definition of done", "dod", "checklist"];
const CONTEXT_HEADINGS = ["context for agent", "agent context"];

function matchesHeading(heading: string, candidates: string[]): boolean {
  const lower = heading.toLowerCase().trim();
  return candidates.some((c) => lower === c);
}

/**
 * Parse a task body into structured sections.
 * Best-effort: never fails. Falls back to treating entire body as description.
 */
export function parseTaskBody(body: string): TaskBody {
  const result: TaskBody = {
    description: "",
    dod: [],
    contextForAgent: "",
    otherSections: [],
  };

  if (!body || !body.trim()) return result;

  // Split by ## headings
  const lines = body.split("\n");
  const sections: { heading: string; content: string }[] = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      sections.push({
        heading: currentHeading,
        content: currentLines.join("\n"),
      });
      currentHeading = headingMatch[1];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  // Push the last section
  sections.push({ heading: currentHeading, content: currentLines.join("\n") });

  // If no headings found, treat entire body as description
  if (sections.length === 1 && sections[0].heading === "") {
    result.description = sections[0].content.trim();
    return result;
  }

  for (const section of sections) {
    const content = section.content.trim();

    if (section.heading === "") {
      // Content before any heading — treat as description prefix
      if (content) result.description = content;
    } else if (matchesHeading(section.heading, DESCRIPTION_HEADINGS)) {
      result.description = content;
    } else if (matchesHeading(section.heading, DOD_HEADINGS)) {
      // Parse checklist items
      const dodLines = section.content.split("\n");
      for (const line of dodLines) {
        const checkMatch = line.match(/^- \[(x| )\]\s*(.*)$/);
        if (checkMatch) {
          result.dod.push({
            checked: checkMatch[1] === "x",
            text: checkMatch[2].trim(),
          });
        }
      }
    } else if (matchesHeading(section.heading, CONTEXT_HEADINGS)) {
      result.contextForAgent = content;
    } else {
      result.otherSections.push({ heading: section.heading, content });
    }
  }

  return result;
}

/**
 * Serialize a TaskBody back into a markdown body string.
 * Preserves unknown sections in their original order.
 */
export function serializeTaskBody(parsed: TaskBody): string {
  const parts: string[] = [];

  // Description
  parts.push("\n## Description\n");
  if (parsed.description) {
    parts.push(parsed.description);
  }
  parts.push("");

  // DoD
  parts.push("## Definition of Done\n");
  if (parsed.dod.length > 0) {
    for (const item of parsed.dod) {
      parts.push(`- [${item.checked ? "x" : " "}] ${item.text}`);
    }
  }
  parts.push("");

  // Other sections (preserved)
  for (const section of parsed.otherSections) {
    parts.push(`## ${section.heading}\n`);
    if (section.content) {
      parts.push(section.content);
    }
    parts.push("");
  }

  // Context for agent
  parts.push("## Context for agent\n");
  if (parsed.contextForAgent) {
    parts.push(parsed.contextForAgent);
  }
  parts.push("");

  return parts.join("\n");
}
