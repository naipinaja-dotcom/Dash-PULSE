import { getServerConfig } from "@/lib/config.server";

// Panggil model Hermes (NousResearch) lewat OpenRouter — API-nya OpenAI-
// compatible jadi cukup fetch biasa ke /chat/completions, gak perlu SDK
// terpisah. Dipakai bareng oleh src/lib/agents/{worker,lead,manager,coo}-agent.ts.
export async function callHermes(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<unknown> {
  const config = getServerConfig();
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY belum di-set di env");
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openRouterApiKey}`,
      // OpenRouter minta identitas app buat dashboard/rate-limit mereka,
      // bukan buat auth — aman di-hardcode.
      "HTTP-Referer": "https://price-set-show.lovable.app",
      "X-Title": "Dash PULSE - Ops Insight Agents", // header value harus ASCII, bukan em dash
    },
    body: JSON.stringify({
      model: config.hermesModel,
      max_tokens: opts.maxTokens ?? 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Respons Hermes kosong/tidak sesuai format");
  }

  // Beberapa model masih suka bungkus JSON dalam ```json fence walau udah
  // diminta response_format json_object — strip dulu sebelum parse.
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Gagal parse JSON dari Hermes: ${cleaned.slice(0, 300)}`);
  }
}
