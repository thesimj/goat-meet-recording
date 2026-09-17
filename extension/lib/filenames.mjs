// Recording filenames: YYYYMMDD-HHmm-<provider>[-<meeting id>].mp4 in local time.

const FALLBACK = Object.freeze({ provider: "chrome-meeting", slug: "" });
const MAX_SLUG_LENGTH = 80;

const TEAMS_HOSTS = ["teams.microsoft.com", "teams.cloud.microsoft", "teams.live.com"];

function googleMeet(url) {
  const code = url.pathname.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/i)?.[1];
  return { provider: "google-meet", slug: code || "" };
}

function zoom(url) {
  const numericId = url.pathname.match(/^\/(?:j|s|wc(?:\/join)?)\/(\d+)(?:\/|$)/)?.[1];
  const personalLink = url.pathname.match(/^\/my\/([a-zA-Z0-9._-]+)(?:\/|$)/)?.[1];
  return { provider: "zoom", slug: numericId || personalLink || "" };
}

function microsoftTeams(url) {
  const encoded = url.pathname.match(/^\/(?:meet|l\/meetup-join)\/([^/]+)/)?.[1];
  if (!encoded) return { provider: "microsoft-teams", slug: "" };
  // decodeURIComponent throws on malformed escapes; the caller falls back to the plain name.
  const slug = decodeURIComponent(encoded).replace(/^19:(?:meeting_)?/, "").replace(/@thread\..*$/, "");
  return { provider: "microsoft-teams", slug };
}

/**
 * Recognize the meeting provider and meeting id from a page URL.
 * Query parameters are ignored, so passcodes never reach the filename.
 */
export function meetingDetails(address) {
  try {
    const url = new URL(address);
    if (!/^https?:$/.test(url.protocol)) return FALLBACK;
    if (url.hostname === "meet.google.com") return googleMeet(url);
    if (/(^|\.)zoom\.(us|com)$/.test(url.hostname)) return zoom(url);
    if (TEAMS_HOSTS.includes(url.hostname)) return microsoftTeams(url);
  } catch {
    // Unknown or malformed URLs use the standard filename.
  }
  return FALLBACK;
}

function safeSlug(slug) {
  return slug.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_SLUG_LENGTH);
}

export function recordingFilename(date = new Date(), meetingUrl = "") {
  const pad = (number) => String(number).padStart(2, "0");
  const { provider, slug } = meetingDetails(meetingUrl);
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const suffix = safeSlug(slug);
  return `${stamp}-${provider}${suffix ? `-${suffix}` : ""}.mp4`;
}

/**
 * Create a new file in the directory, appending -2, -3, ... when the name is taken.
 * A file from the same minute is never overwritten.
 */
export async function newRecordingFile(directory, date = new Date(), meetingUrl = "") {
  const filename = recordingFilename(date, meetingUrl);
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? filename : filename.replace(/\.mp4$/, `-${attempt}.mp4`);
    try {
      await directory.getFileHandle(name);
    } catch (error) {
      if (error.name === "NotFoundError") return directory.getFileHandle(name, { create: true });
      // TypeMismatchError means a folder holds that name. Any other error is a real failure.
      if (error.name !== "TypeMismatchError") throw error;
    }
  }
}
