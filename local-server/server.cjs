/**
 * Local transcript proxy server.
 * Runs on your Mac and fetches YouTube transcripts using your residential IP.
 * Netlify functions call this server via Cloudflare Tunnel.
 */

const http = require("http");

const PORT = 3377;
const SHARED_SECRET = process.env.TRANSCRIPT_PROXY_SECRET || "";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const ANDROID_UA =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 14)";
const INNERTUBE_URL =
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

// Track rate limit state to avoid hammering YouTube
let rateLimitedUntil = 0;

const server = http.createServer(async (req, res) => {
  // CORS and health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
      rateLimited: Date.now() < rateLimitedUntil,
      rateLimitedUntil: rateLimitedUntil > Date.now()
        ? new Date(rateLimitedUntil).toISOString()
        : null,
    }));
    return;
  }

  if (req.method !== "POST" || !req.url.startsWith("/transcript")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // Auth check
  if (SHARED_SECRET) {
    const authHeader = req.headers["authorization"] || "";
    if (authHeader !== `Bearer ${SHARED_SECRET}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  // Parse body
  let body = "";
  for await (const chunk of req) body += chunk;

  let videoId;
  try {
    const parsed = JSON.parse(body);
    videoId = parsed.videoId;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid videoId" }));
    return;
  }

  // If we're rate limited, return early with a clear message
  if (Date.now() < rateLimitedUntil) {
    const waitMin = Math.ceil((rateLimitedUntil - Date.now()) / 60000);
    console.log(`[${ts()}] Rate limited, skipping ${videoId} (${waitMin}min remaining)`);
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: false,
      error: `Rate limited by YouTube. Retry in ~${waitMin} minutes.`,
      rateLimited: true,
      retryAfter: rateLimitedUntil,
    }));
    return;
  }

  console.log(`[${ts()}] Fetching transcript for ${videoId}`);

  try {
    const result = await fetchTranscript(videoId);
    console.log(`[${ts()}] Result for ${videoId}: success=${result.success}, method=${result.method || "none"}, segments=${result.segments?.length || 0}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error(`[${ts()}] Error for ${videoId}:`, err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
});

function ts() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTranscript(videoId) {
  // Strategy 1: InnerTube ANDROID client (best for residential IPs)
  console.log(`[${ts()}]   Strategy 1: InnerTube ANDROID`);
  const itResult = await fetchInnerTubeTracks(videoId);
  if (itResult.tracks && itResult.tracks.length > 0) {
    console.log(`[${ts()}]   Found ${itResult.tracks.length} caption track(s)`);
    const segments = await fetchTranscriptFromTracks(itResult.tracks, "en");
    if (segments && segments.length > 0) {
      return { success: true, segments, method: "innertube" };
    }
  } else {
    console.log(`[${ts()}]   No InnerTube tracks found`);
    // If InnerTube confirmed no captions exist, skip Strategy 2
    if (itResult.permanent) {
      return { success: false, error: "No captions available", permanent: true };
    }
  }

  // Small delay between strategies
  await sleep(500);

  // Strategy 2: Web page scraping with consent cookies
  console.log(`[${ts()}]   Strategy 2: Web page scrape`);
  const webTracks = await fetchWebTracks(videoId);
  if (webTracks && webTracks.length > 0) {
    console.log(`[${ts()}]   Found ${webTracks.length} web caption track(s)`);
    const segments = await fetchTranscriptFromTracks(webTracks, "en");
    if (segments && segments.length > 0) {
      return { success: true, segments, method: "web_scrape" };
    }
  } else {
    console.log(`[${ts()}]   No web tracks found`);
  }

  return { success: false, error: "No transcript available", permanent: false };
}

async function fetchInnerTubeTracks(videoId) {
  try {
    const res = await fetch(INNERTUBE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": ANDROID_UA,
      },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
        videoId,
      }),
    });
    if (!res.ok) {
      console.log(`[${ts()}]   InnerTube API returned ${res.status}`);
      return { tracks: null, permanent: false };
    }
    const data = await res.json();
    const status = data?.playabilityStatus?.status;
    if (status !== "OK") {
      console.log(`[${ts()}]   InnerTube playability: ${status} - ${data?.playabilityStatus?.reason || ""}`);
      // Live streams and other non-OK statuses may change — not permanent
      return { tracks: null, permanent: false };
    }
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      console.log(`[${ts()}]   No caption tracks in InnerTube response`);
      // Status OK + no tracks = creator disabled captions. Permanent.
      return { tracks: null, permanent: true };
    }
    return { tracks, permanent: false };
  } catch (err) {
    console.log(`[${ts()}]   InnerTube error: ${err.message}`);
    return { tracks: null, permanent: false };
  }
}

async function fetchWebTracks(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": WEB_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "CONSENT=PENDING+987",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const marker = "var ytInitialPlayerResponse = ";
    const start = html.indexOf(marker);
    if (start === -1) return null;

    const jsonStart = start + marker.length;
    let depth = 0, end = jsonStart;
    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }

    const pr = JSON.parse(html.slice(jsonStart, end));
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    return tracks;
  } catch {
    return null;
  }
}

async function fetchTranscriptFromTracks(tracks, preferredLang) {
  const track = tracks.find(t => t.languageCode === preferredLang) || tracks[0];
  if (!track?.baseUrl) return null;

  try {
    const url = new URL(track.baseUrl);
    if (!url.hostname.endsWith(".youtube.com")) return null;
  } catch {
    return null;
  }

  // Try with retry for transient failures
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 3000;
      console.log(`[${ts()}]   Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }

    try {
      let fetchUrl = track.baseUrl;
      if (!fetchUrl.includes("fmt=")) fetchUrl += "&fmt=srv3";

      const res = await fetch(fetchUrl, {
        headers: { "User-Agent": WEB_UA },
      });

      if (res.status === 429) {
        console.log(`[${ts()}]   Got 429 rate limit on timedtext fetch`);
        // Set rate limit cooldown: 30 min for first hit, extends on subsequent
        rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + 30 * 60 * 1000);
        return null;
      }

      if (!res.ok) {
        console.log(`[${ts()}]   Timedtext returned ${res.status}`);
        continue;
      }

      const xml = await res.text();
      if (!xml || xml.length === 0) {
        console.log(`[${ts()}]   Empty response from timedtext`);
        continue;
      }

      if (xml.includes("<html") && !xml.includes("<timedtext")) {
        console.log(`[${ts()}]   Got HTML error page instead of XML (${xml.length} bytes)`);
        if (xml.includes("Sorry") || xml.includes("429")) {
          rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + 30 * 60 * 1000);
          return null;
        }
        continue;
      }

      console.log(`[${ts()}]   Got transcript XML: ${xml.length} bytes`);
      const segments = parseTranscriptXml(xml);
      if (segments && segments.length > 0) {
        console.log(`[${ts()}]   Parsed ${segments.length} segments`);
        return segments;
      }
      console.log(`[${ts()}]   Failed to parse any segments from XML`);
    } catch (err) {
      console.log(`[${ts()}]   Fetch error: ${err.message}`);
    }
  }

  return null;
}

function parseTranscriptXml(xml) {
  const segments = [];

  // New format: <p t="ms" d="ms">text</p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const offset = parseInt(match[1], 10);
    const duration = parseInt(match[2], 10);
    let text = match[3];
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;
    let extracted = "";
    while ((sMatch = sRegex.exec(text)) !== null) extracted += sMatch[1];
    if (extracted) text = extracted;
    else text = text.replace(/<[^>]+>/g, "");
    text = decodeEntities(text).trim();
    if (text) segments.push({ text, offset, duration });
  }

  if (segments.length > 0) return segments;

  // Old format: <text start="seconds" dur="seconds">text</text>
  const textRegex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  while ((match = textRegex.exec(xml)) !== null) {
    const offsetSec = parseFloat(match[1]);
    const durationSec = parseFloat(match[2]);
    const text = decodeEntities(match[3]).trim();
    if (text) {
      segments.push({
        text,
        offset: Math.round(offsetSec * 1000),
        duration: Math.round(durationSec * 1000),
      });
    }
  }

  return segments;
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

server.listen(PORT, () => {
  console.log(`Transcript proxy server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Auth: ${SHARED_SECRET ? "enabled" : "DISABLED (set TRANSCRIPT_PROXY_SECRET)"}`);
});
