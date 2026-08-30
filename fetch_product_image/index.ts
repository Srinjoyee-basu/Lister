import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase();

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host === "169.254.169.254"
  ) return true;

  // Block common private IPv4 ranges.
  const parts = host.split(".");
  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
    const n = parts.map(Number);
    if (
      n[0] === 10 ||
      n[0] === 127 ||
      (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
      (n[0] === 192 && n[1] === 168) ||
      n[0] === 0
    ) return true;
  }

  return false;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMeta(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }

  return null;
}

function extractLinkImage(html: string) {
  const match = html.match(
    /<link[^>]+rel=["'][^"']*image_src[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i
  );
  return match?.[1] ? decodeHtml(match[1]) : null;
}

function extractJsonLdImage(html: string) {
  const scripts = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  ) || [];

  for (const script of scripts) {
    const content = script
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    try {
      const data = JSON.parse(content);
      const stack = Array.isArray(data) ? [...data] : [data];

      while (stack.length) {
        const current = stack.shift();
        if (!current || typeof current !== "object") continue;

        if (current.image) {
          if (typeof current.image === "string") return current.image;
          if (Array.isArray(current.image) && typeof current.image[0] === "string") {
            return current.image[0];
          }
          if (current.image?.url) return current.image.url;
        }

        for (const value of Object.values(current)) {
          if (value && typeof value === "object") stack.push(value);
        }
      }
    } catch {
      // Some sites contain invalid JSON-LD. Continue to other metadata.
    }
  }

  return null;
}

function resolveImage(image: string | null, source: URL) {
  if (!image) return null;

  try {
    return new URL(image, source.href).href;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "POST required" }, 405);
  }

  try {
    const body = await req.json();
    const rawUrl = String(body?.url || "").trim();

    if (!rawUrl) return json({ image_url: null });

    let source: URL;
    try {
      source = new URL(rawUrl);
    } catch {
      return json({ error: "Invalid source URL" }, 400);
    }

    if (!["http:", "https:"].includes(source.protocol)) {
      return json({ error: "Only HTTP and HTTPS source URLs are supported" }, 400);
    }

    if (isBlockedHost(source.hostname)) {
      return json({ error: "Source host is not allowed" }, 400);
    }

    const response = await fetch(source.href, {
      headers: {
        "User-Agent": "ListerBot/1.0 (+product-image-preview)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return json({ image_url: null, error: `Source returned ${response.status}` });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return json({ image_url: null });
    }

    const html = (await response.text()).slice(0, 2_000_000);
    const finalUrl = new URL(response.url || source.href);

    let image =
      extractMeta(html, "og:image") ||
      extractMeta(html, "twitter:image") ||
      extractMeta(html, "twitter:image:src") ||
      extractLinkImage(html) ||
      extractJsonLdImage(html);

    image = resolveImage(image, finalUrl);

    return json({ image_url: image });
  } catch (error) {
    console.error(error);
    return json({ image_url: null, error: "Could not read the source page" }, 500);
  }
});
