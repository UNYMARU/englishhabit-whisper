import OpenAI from "openai";
import ytdl from "@distube/ytdl-core";
import fs from "fs";
import os from "os";
import path from "path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).end();
    }

    const { videoId } = req.query || {};
    if (!videoId || !/^[A-Za-z0-9_-]{6,}$/.test(String(videoId))) {
      return res.status(400).json({ error: "Invalid videoId" });
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const tmp = path.join(os.tmpdir(), `yt-${videoId}-${Date.now()}.webm`);

    // 오디오 추출
    await new Promise((resolve, reject) => {
      const w = fs.createWriteStream(tmp);
      const stream = ytdl(url, {
        quality: "highestaudio",
        filter: "audioonly",
        highWaterMark: 1 << 25,
        dlChunkSize: 0
      });
      stream.on("error", reject);
      w.on("error", reject);
      w.on("finish", resolve);
      stream.pipe(w);
    });

    // Whisper 전사
    const tr = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmp),
      model: "whisper-1",
      response_format: "verbose_json",
      temperature: 0
    });

    const segments = Array.isArray(tr.segments)
      ? tr.segments.map(s => ({ start: s.start, end: s.end, text: s.text }))
      : [];

    res.status(200).json({ text: tr.text || "", segments });

    try { fs.unlink(tmp, () => {}); } catch {}
  } catch (err) {
    console.error("[WHISPER ERROR]", err);
    res.status(500).json({ error: "Whisper failed", detail: String(err?.message || err) });
  }
}
