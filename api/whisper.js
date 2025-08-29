// api/whisper.js — Express Router (Railway용)
import { Router } from "express";
import OpenAI from "openai";
import ytdl from "@distube/ytdl-core";
import fs from "fs";
import os from "os";
import path from "path";

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// (선택) 헤더 튜닝: 없으면 디폴트로 동작. 있으면 410/403 회피 확률 ↑
const rawUA =
  process.env.YT_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const rawCOOKIE = process.env.YT_COOKIE || "";

// 줄바꿈/양끝 공백 제거 (헤더 오류 예방)
const UA = rawUA.replace(/[\r\n]/g, " ").trim();
const COOKIE = rawCOOKIE.replace(/[\r\n]/g, " ").trim();

function reqOpts() {
  const headers = {
    "user-agent": UA,
    "accept-language": "en-US,en;q=0.9,ko;q=0.8",
    referer: "https://www.youtube.com/"
  };
  if (COOKIE) headers.cookie = COOKIE;
  return { headers };
}

function isValidId(id) {
  return /^[A-Za-z0-9_-]{6,}$/.test(String(id || "").trim());
}

router.get("/", async (req, res) => {
  try {
    // CORS (원하면 프론트 호출용)
    res.setHeader("Access-Control-Allow-Origin", "*");

    const { videoId } = req.query || {};
    if (!isValidId(videoId)) {
      return res.status(400).json({ error: "Invalid videoId" });
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const tmp = path.join(os.tmpdir(), `yt-${videoId}-${Date.now()}.webm`);

    // 1) YouTube 오디오 추출
    await new Promise((resolve, reject) => {
      const w = fs.createWriteStream(tmp);
      const stream = ytdl(url, {
        requestOptions: reqOpts(),
        quality: "highestaudio",
        filter: "audioonly",
        highWaterMark: 1 << 25, // 32MB
        dlChunkSize: 0          // 단일 청크
      });
      stream.on("error", reject);
      w.on("error", reject);
      w.on("finish", resolve);
      stream.pipe(w);
    });

    // 0바이트 방지
    const stat = fs.statSync(tmp);
    if (!stat.size) throw new Error("Downloaded file is empty");

    // 2) Whisper 전사
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

    // 임시파일 정리 (best-effort)
    try { fs.unlink(tmp, () => {}); } catch {}
  } catch (err) {
    console.error("[WHISPER ERROR]", err);
    const code =
      err?.statusCode || err?.status || err?.code || (err?.response && err.response.status);
    const msg =
      err?.message ||
      (err?.response && err.response.data ? JSON.stringify(err.response.data) : String(err));
    res.status(500).json({
      error: "Whisper failed",
      detail: code ? `Status code: ${code}` : msg
    });
  }
});

export default router;
