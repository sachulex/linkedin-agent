export type Style = {
  version?: string;
  voice_rules?: {
    persona?: string;
    banned_words?: string[];
    formatting?: { no_dashes?: boolean };
  };
  post_structure?: {
    must_include_phrase?: string;
    topic_focus?: string;
    closing_cta?: string;
  };
  image_style?: { enabled?: boolean };
};

export async function fetchStyleLocal(): Promise<Style> {
  const port = process.env.PORT || "3000";
  const url = `http://127.0.0.1:${port}/v1/style`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET /v1/style ${res.status}`);
    return (await res.json()) as Style;
  } catch {
    // Safe defaults if style is missing
    return {
      voice_rules: {
        persona: "Casual yet professional, concise, human.",
        banned_words: ["boost"],
        formatting: { no_dashes: true }
      },
      post_structure: {
        closing_cta: "If you want the exact setup details, ask for the README."
      },
      image_style: { enabled: false }
    };
  }
}

export function enforceStyleOnPost(raw: string, style: Style): string {
  let post = String(raw || "");

  // 1) Remove banned words
  const banned = style.voice_rules?.banned_words || [];
  for (const w of banned) {
    if (!w) continue;
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "gi");
    post = post.replace(re, "");
  }

  // 2) No dashes if requested
  if (style.voice_rules?.formatting?.no_dashes) {
    post = post.replace(/—|–|-/g, " ");
    // normalize double spaces
    post = post.replace(/[ \t]{2,}/g, " ");
  }

  // 3) Must-include phrase
  const must = style.post_structure?.must_include_phrase?.trim();
  if (must && !new RegExp(must.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&"), "i").test(post)) {
    post = `${post}\n\n${must}`;
  }

  // 4) Topic focus nudge
  const focus = style.post_structure?.topic_focus?.trim();
  if (focus && !/topic focus:/i.test(post)) {
    post = `${post}\n\nTopic focus: ${focus}`;
  }

  // 5) Closing CTA
  const cta = style.post_structure?.closing_cta?.trim();
  if (cta && !post.toLowerCase().includes(cta.toLowerCase())) {
    post = `${post}\n\n${cta}`;
  }

  return post.trim();
}
