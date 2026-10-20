import { describe, expect, it } from "vitest";
import { describeDevice, estimateDelay, health, quickStart, viewerAlerts, type ViewerStats } from "./protocol";
import { checkSlug, suggestSlug } from "./slug";

const base: ViewerStats = {
  vw: 1600, vh: 900, sw: 1920, sh: 1080, portrait: false, fullscreen: true, visible: true,
  fps: 30, frameW: 1920, frameH: 1080, rtt: 0.06, buffer: 0.08, lossPct: 0,
};
const computer = { kind: "computer" as const, label: "Mac computer" };
const iphone = { kind: "phone" as const, label: "iPhone" };

describe("screen share viewer alerts", () => {
  it("no alerts when all is well", () => {
    expect(viewerAlerts(base, computer)).toEqual([]);
    expect(health(base)).toBe("good");
    expect(estimateDelay(base)).toBeCloseTo(0.16, 2);
  });
  it("phone held upright, then sideways but not full screen", () => {
    expect(viewerAlerts({ ...base, vw: 390, vh: 844, portrait: true, fullscreen: false }, iphone)[0]).toMatch(/upright/);
    expect(viewerAlerts({ ...base, vw: 844, vh: 390, fullscreen: false }, iphone)[0]).toMatch(/full-screen/);
  });
  it("switched tabs, small window, slow connection", () => {
    expect(viewerAlerts({ ...base, visible: false }, computer)[0]).toMatch(/switched/);
    expect(viewerAlerts({ ...base, vw: 800, fullscreen: false }, computer)[0]).toMatch(/window is small/);
    expect(health({ ...base, fps: 8 })).toBe("slow");
    expect(health({ ...base, fps: 2, lossPct: 20 })).toBe("bad");
  });
  it("tells devices apart", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", true, 390).label).toBe("iPhone");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile", true, 412).kind).toBe("phone");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", false, 1080).label).toBe("Windows computer");
  });
});

describe("quick start", () => {
  it("adds a start bitrate to video codecs only", () => {
    const sdp = ["v=0", "m=audio 9 UDP 111", "a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10", "m=video 9 UDP 96 98", "a=rtpmap:96 VP8/90000", "a=rtpmap:98 VP9/90000", "a=fmtp:98 profile-id=0", ""].join("\r\n");
    const out = quickStart(sdp, 1500);
    expect(out).toContain("a=fmtp:96 x-google-start-bitrate=1500");
    expect(out).toContain("a=fmtp:98 profile-id=0;x-google-start-bitrate=1500");
    expect(out).toContain("a=fmtp:111 minptime=10\r\n");
  });
});

describe("rep link names", () => {
  it("cleans and checks", () => {
    expect(checkSlug(" Corban ").slug).toBe("corban");
    expect(checkSlug("pricing").error).toMatch(/website/);
    expect(checkSlug("a").error).toBeTruthy();
    expect(checkSlug("").slug).toBeUndefined();
    expect(suggestSlug("Sal G")).toBe("sal");
  });
});
