// server.js — Railway entry
import express from "express";
import whisperRouter from "./api/whisper.js";

const app = express();
const PORT = process.env.PORT || 3000;

// 헬스체크 (Railway 상태 확인용)
app.get("/", (req, res) => {
  res.send("✅ Whisper API is running on Railway");
});

// /api/whisper 라우터 연결
app.use("/api/whisper", whisperRouter);

// 에러 핸들러(안전망)
app.use((err, req, res, next) => {
  console.error("[SERVER ERROR]", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}`);
});
