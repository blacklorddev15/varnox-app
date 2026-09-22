const mongoose = require("mongoose");
const dns = require("dns");

// Fix querySrv ECONNREFUSED error by forcing Node.js to use Google DNS
dns.setServers(["8.8.8.8", "8.8.4.4"]);

// Serverless functions are created and torn down constantly, so a fresh mongoose.connect()
// per invocation would exhaust MongoDB Atlas' connection limit (M0 allows 500).
// Caching the promise on `global` keeps one connection alive for the lifetime of the
// function instance and lets concurrent invocations await the same in-flight promise.
let cached = global._mongooseConnection;

if (!cached) {
  cached = global._mongooseConnection = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cached.conn) return cached.conn;

  if (!process.env.MONGO_URI) {
    // Previously this path called process.exit(1), which kills the whole serverless
    // instance on every cold start. Throwing lets the request return a 500 instead.
    throw new Error("MONGO_URI is not set");
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(process.env.MONGO_URI, {
        // Keep the pool small: many short-lived instances each holding a large pool
        // is what exhausts Atlas connections.
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
        bufferCommands: false,
      })
      .then((conn) => {
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
        return conn;
      })
      .catch((error) => {
        // Reset so the next invocation retries rather than caching a rejected promise.
        cached.promise = null;
        console.error(`Error connecting to MongoDB: ${error.message}`);
        throw error;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
};

module.exports = connectDB;
