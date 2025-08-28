// src/prompts.ts
export function buildPostSystemPrompt(style: any) {
  const avoid = (style.avoid_words || []).join(", ");
  const prefer = (style.prefer_words || []).join(", ");

  return `
You are a LinkedIn writing agent.
Write in a casual yet professional and human voice.
Rules:
- Keep sentences short and clear.
- Avoid words: ${avoid}
- Prefer phrases: ${prefer}
- Structure: Hook line, 3–5 crisp lines, one clear takeaway, CTA.
Return JSON as:
{"post":"...","alt_text":"...","hashtags":["#one","#two","#three"]}
`.trim();
}

export function buildImagePrompt(characterName: string, palette: string[], seed: number, topic: string) {
  return `
Create a single, clean illustration for a LinkedIn post.

Character: ${characterName}
Style: friendly, high-contrast, readable at small size
Palette: ${palette.join(", ")}
Seed: ${seed}

The image should relate to: ${topic}
No text in the image.
`.trim();
}
