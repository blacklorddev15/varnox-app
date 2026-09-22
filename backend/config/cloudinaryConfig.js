const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const dotenv = require("dotenv");

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload an in-memory file buffer to Cloudinary.
 *
 * This used to take a path from multer.diskStorage and call uploader.upload()/upload_large().
 * That cannot work on Vercel: the function filesystem is read-only apart from /tmp, and it is
 * not shared between invocations, so a file written by one request is invisible to the next.
 * Buffers avoid the filesystem entirely.
 */
const uploadOnCloudinary = async (file) => {
  if (!file) return null;

  const buffer = file.buffer;
  if (!buffer) {
    throw new Error(
      "File has no buffer — multer is not using memoryStorage. Uploads cannot work on a serverless host."
    );
  }

  const isImage = file.mimetype?.startsWith("image");

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: isImage ? "image" : "video" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
};

// Memory storage: the buffer is handed straight to Cloudinary.
// The 4 MB cap is deliberately under Vercel's hard 4.5 MB request-body limit, so an
// oversized upload fails with a clear 413 instead of being refused by the platform.
const storage = multer.memoryStorage();

const uploadFields = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
}).fields([
  { name: "media", maxCount: 1 },
  { name: "file", maxCount: 1 },
]);

const multerMiddleware = (req, res, next) => {
  uploadFields(req, res, (err) => {
    if (err) {
      // Surface the reason rather than silently continuing with no file attached.
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({
        status: "error",
        message:
          err.code === "LIMIT_FILE_SIZE"
            ? "File is too large. The maximum upload size is 4 MB."
            : `Upload failed: ${err.message}`,
      });
    }
    if (req.files) {
      req.file = req.files.media?.[0] || req.files.file?.[0] || req.file;
    }
    next();
  });
};

module.exports = { uploadOnCloudinary, cloudinary, multerMiddleware };
