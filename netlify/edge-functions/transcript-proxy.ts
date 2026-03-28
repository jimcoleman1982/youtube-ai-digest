import type { Config } from "https://edge.netlify.com";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const ANDROID_UA =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 14)";
const CONSENT_COOKIES =
  "CONSENT=PENDING+987; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgN72pwY";
const INNERTUBE_URL =
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId");

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return Response.json(
      { error: "Invalid or missing videoId parameter" },
      { status: 400 }
    );
  }

  try {
    // Fetch watch page to get visitorData
    const watchRes = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      {
        headers: {
          "User-Agent": WEB_UA,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: CONSENT_COOKIES,
        },
      }
    );

    const html = await watchRes.text();

    if (html.includes("unusual traffic")) {
      return Response.json({
        success: false,
        error: "Bot detected by YouTube",
      });
    }

    const vdMatch = html.match(/"VISITOR_DATA":"([^"]+)"/);
    const visitorData = vdMatch ? vdMatch[1] : "";

    // Try InnerTube ANDROID with visitorData
    if (visitorData) {
      const setCookies: string[] = [];
      watchRes.headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") {
          setCookies.push(value.split(";")[0]);
        }
      });
      const sessionCookies = setCookies.join("; ") + "; " + CONSENT_COOKIES;

      const innerRes = await fetch(INNERTUBE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": ANDROID_UA,
          Cookie: sessionCookies,
          "X-Goog-Visitor-Id": visitorData,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "ANDROID",
              clientVersion: "20.10.38",
              visitorData,
            },
          },
          videoId,
        }),
      });

      const innerData = await innerRes.json();

      const tracks =
        innerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (tracks && tracks.length > 0) {
        const track =
          tracks.find((t: CaptionTrack) => t.languageCode === "en") ||
          tracks[0];

        const tRes = await fetch(track.baseUrl, {
          headers: { "User-Agent": WEB_UA },
        });
        const xml = await tRes.text();

        if (
          xml.length > 0 &&
          (xml.includes("<timedtext") || xml.includes("<?xml"))
        ) {
          return Response.json({
            success: true,
            transcript: xml,
            method: "innertube_with_visitor",
          });
        }
      }
    }

    // Fallback: try parsing captions directly from watch page
    const captionMatch = html.match(/"captionTracks":(\[.*?\])/);
    if (captionMatch) {
      try {
        const tracks = JSON.parse(captionMatch[1]);
        const track =
          tracks.find((t: CaptionTrack) => t.languageCode === "en") ||
          tracks[0];
        if (track?.baseUrl) {
          const tRes = await fetch(track.baseUrl, {
            headers: { "User-Agent": WEB_UA },
          });
          const xml = await tRes.text();
          if (
            xml.length > 0 &&
            (xml.includes("<timedtext") || xml.includes("<?xml"))
          ) {
            return Response.json({
              success: true,
              transcript: xml,
              method: "watch_page_captions",
            });
          }
        }
      } catch {
        // fallthrough
      }
    }

    return Response.json({
      success: false,
      error: "No transcript available",
    });
  } catch (err) {
    return Response.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: "/edge/transcript-proxy",
};
