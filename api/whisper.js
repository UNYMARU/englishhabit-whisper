// api/whisper.js — FINAL (쿠키 없어도 동작)
// Vercel Serverless / ESM. 루트 package.json에 "type":"module" 필요.
import OpenAI from "openai";
import ytdl from "ytdl-core";
import fs from "fs";
import os from "os";
import path from "path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- 요청 헤더 (브라우저처럼 보이게) ---
const UA =
  process.env.YT_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// 선택: 필요하면 환경변수로 쿠키 추가 가능 (없어도 작동)
const COOKIE = process.env.YT_COOKIE || "";

function buildReqOpts() {
  const headers = {
    "user-agent": UA,
    "accept-language": "en-US,en;q=0.9,ko;q=0.8",
    referer: "https://www.youtube.com/",
  };
  if (COOKIE) headers.cookie = COOKIE;
  return { headers };
}

function isValidId(id) {
  return /^[A-Za-z0-9_-]{6,}$/.test(String(id || "").trim());
}

// --- YouTube 오디오 다운로드 (2단계 재시도) ---
async function downloadAudio(url, outPath) {
  // 1) getInfo → chooseFormat → downloadFromInfo
  try {
    const info = await ytdl.getInfo(url, { requestOptions: buildReqOpts() });

    let format = ytdl.chooseFormat(info.formats, {
      quality: "highestaudio",
      filter: "audioonly",
    });
    if (!format || !format.url) {
      format = ytdl.chooseFormat(info.formats, { quality: "highestaudio" });
    }

    await new Promise((resolve, reject) => {
      const write = fs.createWriteStream(outPath);
      const stream = ytdl.downloadFromInfo(info, {
        requestOptions: buildReqOpts(),
        format,
        quality: "highestaudio",
        filter: "audioonly",
        highWaterMark: 1 << 25, // 32MB
        dlChunkSize: 0, // 단일 청크
      });
      stream.on("error", reject);
      write.on("error", reject);
      write.on("finish", resolve);
      stream.pipe(write);
    });
    return; // 성공
  } catch (e) {
    // 첫 시도 실패 시, 로그만 남기고 2차 시도
    console.error("[YTDL 1st try failed]", e?.statusCode || "", e?.message || e);
  }

  // 2) URL 직접 다운로드 (옵션 축소)
  await new Promise((resolve, reject) => {
    const write = fs.createWriteStream(outPath);
    const stream = ytdl(url, {
      requestOptions: buildReqOpts(),
      quality: "highestaudio",
      filter: "audioonly",
      highWaterMark: 1 << 25,
      dlChunkSize: 0,
    });
    stream.on("error", reject);
    write.on("error", reject);
    write.on("finish", resolve);
    stream.pipe(write);
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  try {
    const { videoId } = req.query || {};
    if (!isValidId(videoId)) {
      return res.status(400).json({ error: "Invalid videoId" });
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const tmpPath = path.join(os.tmpdir(), `yt-${videoId}-${Date.now()}.webm`);

    // === 1) 오디오 추출 ===
    await downloadAudio(url, tmpPath);

    // 0바이트 방지
    const stat = fs.statSync(tmpPath);
    if (!stat.size) throw new Error("Downloaded file is empty");

    // === 2) Whisper 전사 ===
    const tr = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1",
      response_format: "verbose_json",
      temperature: 0,
    });

    const segments = Array.isArray(tr.segments)
      ? tr.segments.map((s) => ({ start: s.start, end: s.end, text: s.text }))
      : [];

    res.status(200).json({ text: tr.text || "", segments });
    try { fs.unlink(tmpPath, () => {}); } catch {}
  } catch (err) {
    // 가능한 많은 진단 정보 반환
    const statusLike =
      err?.statusCode || err?.status || err?.code || (err?.response && err.response.status);
    const msg =
      err?.message ||
      (err?.response && err.response.data ? JSON.stringify(err.response.data) : String(err));

    console.error("[WHISPER ERROR]", statusLike || "", msg);
    res.status(500).json({
      error: "Whisper failed",
      detail: statusLike ? `Status code: ${statusLike}` : msg,
    });
  }
}
