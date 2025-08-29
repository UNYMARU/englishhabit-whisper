// api/whisper.js  — 410 Gone 완화 버전
import OpenAI from "openai";
import ytdl from "ytdl-core";
import fs from "fs";
import os from "os";
import path from "path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 선택: 헤더 보강용 환경변수 (없어도 작동)
const UA = process.env.YT_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const COOKIE = process.env.YT_COOKIE || "";

function buildReqOpts() {
  const headers = {
    "user-agent": UA,
    "accept-language": "en-US,en;q=0.9,ko;q=0.8",
    "referer": "https://www.youtube.com/"
  };
  if (COOKIE) headers.cookie = COOKIE;
  return { headers };
}


async function downloadAudio(url, outPath) {
  const info = await ytdl.getInfo(url, { requestOptions: buildReqOpts() });

  let format = ytdl.chooseFormat(info.formats, { quality: "highestaudio", filter: "audioonly" });
  if (!format || !format.url) {
    format = ytdl.chooseFormat(info.formats, { quality: "highestaudio" });
  }

  // 1차: info 기반 다운로드
  try {
    await new Promise((resolve, reject) => {
      const w = fs.createWriteStream(outPath);
      const s = ytdl.downloadFromInfo(info, {
        requestOptions: buildReqOpts(),
        format,
        highWaterMark: 1 << 25,
        dlChunkSize: 0,
        quality: "highestaudio",
        filter: "audioonly"
      });
      s.on("error", reject);
      w.on("error", reject);
      w.on("finish", resolve);
      s.pipe(w);
    });
    return;
  } catch (_) {
    // 2차: URL 직접 + 옵션 축소
    await new Promise((resolve, reject) => {
      const w = fs.createWriteStream(outPath);
      const s = ytdl(url, {
        requestOptions: buildReqOpts(),
        quality: "highestaudio",
        filter: "audioonly",
        highWaterMark: 1 << 25,
        dlChunkSize: 0
      });
      s.on("error", reject);
      w.on("error", reject);
      w.on("finish", resolve);
      s.pipe(w);
    });
  }
}

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

    await downloadAudio(url, tmp);

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
    console.error("[WHISPER ERROR]", err?.statusCode || err?.status || "", err?.message || err);
    res.status(500).json({ error: "Whisper failed", detail: String(err?.message || err) });
  }
}
