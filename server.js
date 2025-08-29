import express from "express";
import OpenAI from "openai";
import ytdl from "ytdl-core";
import fs from "fs";
import os from "os";
import path from "path";

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const UA = process.env.YT_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const COOKIE = process.env.YT_COOKIE || "";

function buildReqOpts() {
  const headers = { "user-agent": UA, referer: "https://www.youtube.com/" };
  if (COOKIE) headers.cookie = COOKIE;
  return { headers };
}

app.get("/api/whisper", async (req, res) => {
  try {
    const videoId = String(req.query.videoId || "");
    if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId))
      return res.status(400).json({ error: "Invalid videoId" });

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const tmp = path.join(os.tmpdir(), `yt-${videoId}-${Date.now()}.webm`);

    await new Promise((resolve, reject) => {
      const w = fs.createWriteStream(tmp);
      const s = ytdl(url, {
        requestOptions: buildReqOpts(),
        quality: "highestaudio",
        filter: "audioonly",
        highWaterMark: 1 << 25,
        dlChunkSize: 0,
      });
      s.on("error", reject);
      w.on("error", reject);
      w.on("finish", resolve);
      s.pipe(w);
    });

    const tr = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmp),
      model: "whisper-1",
      response_format: "verbose_json"
    });

    const segments = Array.isArray(tr.segments)
      ? tr.segments.map(s => ({ start: s.start, end: s.end, text: s.text }))
      : [];

    res.json({ text: tr.text || "", segments });
    try { fs.unlink(tmp, () => {}); } catch {}
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Whisper failed", detail: String(e?.message) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on", port));
