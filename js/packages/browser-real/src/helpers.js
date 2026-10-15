const CHALLENGE_RE = /captcha|challenge|unusual traffic|verify you are human|cf-browser-verification/i;
const USER_PROFILE_RE = /(?:Google[/\\]Chrome|Microsoft[/\\]Edge|BraveSoftware|Mozilla[/\\]Firefox)/i;

export function isDefaultUserProfile(profileDir) {
  return USER_PROFILE_RE.test(String(profileDir ?? ""));
}

export function detectChallenge(text) {
  return CHALLENGE_RE.test(String(text ?? ""));
}

export function nodeMajor() {
  return Number.parseInt(String(process.versions.node).split(".")[0], 10);
}

export const LOCAL_COMMANDS = Object.freeze([
  "session.start",
  "session.close",
  "session.status",
  "session.pause",
  "session.resume",
  "session.retry",
  "navigate",
  "back",
  "forward",
  "reload",
  "wait",
  "snapshot.dom",
  "snapshot.ax",
  "locate",
  "click",
  "type",
  "select",
  "press",
  "hover",
  "focus",
  "check",
  "uncheck",
  "dblclick",
  "scroll",
  "upload",
  "tap",
  "swipe",
  "longpress",
  "pinch",
  "drag",
  "markdown",
  "screenshot",
  "pdf",
  "download",
  "cancel",
]);

export const PROBE_OPERATIONS = Object.freeze([
  "navigate",
  "back",
  "markdown",
  "snapshot.dom",
  "snapshot.ax",
  "click",
  "type",
  "screenshot",
  "pdf",
  "download",
]);
