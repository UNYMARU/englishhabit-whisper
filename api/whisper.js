// api/whisper.js  (Vercel Serverless)
// package.json 에 "type":"module" 필수!
import OpenAI from "openai";
import ytdl from "ytdl-core";
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

    // 1) 오디오 추출
    await new Promise((resolve, reject) => {
      const write = fs.createWriteStream(tmp);
      const stream = ytdl(url, {
        quality: "highestaudio",
        filter: "audioonly",
        highWaterMark: 1 << 25,
      });
      stream.on("error", reject);
      write.on("error", reject);
      write.on("finish", resolve);
      stream.pipe(write);
    });

    // 2) Whisper 전사
    const tr = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmp),
      model: "whisper-1",
      response_format: "verbose_json",
      temperature: 0,
    });

    const segments = Array.isArray(tr.segments)
      ? tr.segments.map((s) => ({ start: s.start, end: s.end, text: s.text }))
      : [];

    res.status(200).json({ text: tr.text || "", segments });

    try { fs.unlink(tmp, () => {}); } catch (_) {}
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Whisper failed", detail: String(err?.message || err) });
  }
}
