const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const http = require("http");

const connectDB = require("./config/dbConnect");
const authRoute = require("./routes/authRoute");
const chatRoute = require("./routes/chatRoute");
const statusRoute = require("./routes/statusRoute");
const trtcRoute = require("./routes/trtcRoute");
const { initializeSocket } = require("./services/socketService");
require("./services/firebaseService");

const app = express();

// Explicit origin allowlist.
//
// The previous version called callback(null, true) in its else branch, so it reflected *any*
// origin while also sending credentials. The https://localhost and capacitor://localhost
// entries are the WebView origins used by the packaged Android app — without them the APK
// cannot reach this API at all.
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.PUBLIC_WEB_URL,
  "https://localhost",
  "capacitor://localhost",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header: same-origin requests and non-browser clients (curl, native fetch).
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check is mounted BEFORE the database gate so it can confirm the function itself is
// alive and honest about configuration even when the database is unreachable.
app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    service: "varnox-api",
    mongoConfigured: Boolean(process.env.MONGO_URI),
    cloudinaryConfigured: Boolean(process.env.CLOUDINARY_CLOUD_NAME),
    trtcConfigured: Boolean(process.env.TRTC_SDK_APP_ID && process.env.TRTC_SDK_SECRET_KEY),
    emailProvider: process.env.RESEND_API_KEY ? "resend" : "gmail-smtp",
    ts: Date.now(),
  })
);

// Establish (or reuse) the MongoDB connection before any data route runs. connectDB() caches
// the connection on `global`, so this is cheap on warm invocations.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    return next();
  } catch (err) {
    return res.status(503).json({
      status: "error",
      message: "Database unavailable",
      error: err.message,
    });
  }
});

const server = http.createServer(app);
const io = initializeSocket(server);

app.use((req, res, next) => {
  req.io = io;
  req.socketUserMap = io.socketUserMap;
  next();
});

app.use("/api/auth", authRoute);
app.use("/api/chat", chatRoute);
app.use("/api/chats", chatRoute);
app.use("/api/status", statusRoute);
app.use("/api/trtc", trtcRoute);

// Nothing above may call server.listen(): on Vercel the platform owns the listener and drives
// the exported server. `index.js` attaches the listener for local development only.
module.exports = { app, server, io };
