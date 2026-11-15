// Records the app's guided tour to MP4: Chrome DevTools screencast frames → ffmpeg (variable frame timing preserved).
// usage: node record-tour.mjs <url> <out.mp4> [--probe] [--voice <demo/voice/durations.json> --narration <demo/narration.json>]
// With --voice, every step lasts at least as long as its narration (+0.9 s) and step start times are written to <out>.steps.json.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);
const [url, out] = argv;
const probe = argv.includes("--probe");
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const voice = opt("--voice") ? JSON.parse(readFileSync(opt("--voice"), "utf8")).durations : {};
const narration = opt("--narration") ? JSON.parse(readFileSync(opt("--narration"), "utf8")) : [];
const minOf = Object.fromEntries(narration.map((n) => [n.id, n.min]));
const W = 1920, H = 1080;
const dir = join(process.cwd(), "frames");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(url, { waitUntil: "load" });
await page.waitForSelector(".hero", { timeout: 60000 });
await sleep(6000); // globe tiles + fonts
if (probe) {
  await page.screenshot({ path: out });
  const gl = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
  console.log("webgl2", gl);
  await browser.close();
  process.exit(0);
}

const cdp = await ctx.newCDPSession(page);
const frames = [];
let n = 0;
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const f = join(dir, `f${String(n++).padStart(6, "0")}.jpg`);
  writeFileSync(f, Buffer.from(data, "base64"));
  frames.push({ f, t: metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const t0 = Date.now() / 1000;
// keep the compositor producing frames even when Cesium idles (requestRenderMode)
await page.evaluate(() => {
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:.01;pointer-events:none;z-index:99999";
  document.body.appendChild(d);
  let k = 0;
  setInterval(() => (d.style.transform = `translateX(${(k ^= 1)}px)`), 50);
});

const next = () => page.locator(".tour-card footer button.primary").click();
const marks = {};
let stepStart = 0;
const begin = (id) => { stepStart = Date.now() / 1000; marks[id] = +(stepStart - t0).toFixed(3); };
// hold the step until both its own content time and its narration have finished
const hold = async (id, fallback) => {
  const need = Math.max(minOf[id] ?? fallback, (voice[id] ?? 0) + 0.9, fallback && !voice[id] ? fallback : 0);
  const left = need - (Date.now() / 1000 - stepStart);
  if (left > 0) await sleep(left * 1000);
};
const waitFor = (sel, ms = 90000) => page.waitForSelector(sel, { timeout: ms }).catch(() => console.log("timeout waiting", sel));

begin("hero"); await hold("hero", 4.5);
await page.locator(".hero-actions button.primary").click();
begin("challenge"); await waitFor(".tour-card"); await hold("challenge", 5.5);
await next(); begin("studio"); await waitFor(".cs-rows"); await hold("studio", 7);
await next(); begin("seasons"); await waitFor(".cs-heat"); await hold("seasons", 6.5);
await next(); begin("spiral"); await waitFor(".cs-spiral"); await hold("spiral", 16);
await next(); begin("significance"); await waitFor(".cs-hist"); await hold("significance", 7);
await next(); begin("satellite"); await waitFor(".cs-cross-card"); await hold("satellite", 9);
await next(); begin("trendmap"); await waitFor(".tm-panel");
await page.waitForFunction(() => /Cells with a trend/.test(document.querySelector(".tm-panel")?.textContent || ""), null, { timeout: 180000 }).catch(() => {});
await sleep(2500); await hold("trendmap", 10);
await next(); begin("aral"); await sleep(4000);
const box = await page.locator(".swipe-divider").boundingBox();
if (box) {
  const y = box.y + box.height / 2, x0 = box.x + box.width / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 0; i <= 30; i++) { await page.mouse.move(x0 - 380 * (i / 30), y); await sleep(40); }
  for (let i = 0; i <= 50; i++) { await page.mouse.move(x0 - 380 + 700 * (i / 50), y); await sleep(40); }
  for (let i = 0; i <= 25; i++) { await page.mouse.move(x0 + 320 - 320 * (i / 25), y); await sleep(40); }
  await page.mouse.up();
}
await hold("aral", 11);
await next(); begin("landcover"); await hold("landcover", 9);
await next(); begin("ai"); await waitFor(".ai-panel"); await sleep(1500);
await page.locator(".ai-activate").first().click().catch(() => {});
await waitFor(".ai-result", 120000); await sleep(2500); await hold("ai", 10);
await next(); begin("end"); await hold("end", 5);
writeFileSync(out.replace(/\.mp4$/, "") + ".steps.json", JSON.stringify(marks, null, 1));

await cdp.send("Page.stopScreencast");
await sleep(500);
const tEnd = Date.now() / 1000;
await browser.close();

// concat list with per-frame durations
const lines = ["ffconcat version 1.0"];
frames.sort((a, b) => a.t - b.t);
for (let i = 0; i < frames.length; i++) {
  const dur = (i + 1 < frames.length ? frames[i + 1].t : frames[i].t + Math.max(0.5, tEnd - t0 - (frames[i].t - frames[0].t))) - frames[i].t;
  lines.push(`file '${frames[i].f}'`, `duration ${Math.max(0.001, Math.min(dur, 10)).toFixed(4)}`);
}
lines.push(`file '${frames[frames.length - 1].f}'`);
writeFileSync(join(process.cwd(), "frames.txt"), lines.join("\n"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "frames.txt",
  "-vf", `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "20",
  "-movflags", "+faststart", out], { stdio: "inherit" });
console.log("frames", frames.length, "seconds", (frames.at(-1).t - frames[0].t).toFixed(1), "->", out);
