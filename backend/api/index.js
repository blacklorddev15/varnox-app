// Vercel Function entry point.
//
// Vercel's Node.js runtime accepts an exported http.Server, which lets a single function serve
// both the HTTP API and the Socket.IO WebSocket upgrade. This is why app.js deliberately never
// calls listen().
//
// Kept as CommonJS with a static require() rather than ESM/CJS interop, because Vercel traces
// dependencies with @vercel/nft — a dynamic require would not be discovered and the function
// would fail at runtime with MODULE_NOT_FOUND.
const { server, app, io } = require("../app");

module.exports = server;
// Also expose the ESM interop shape and the app, for runtimes that look for them.
module.exports.default = server;
module.exports.app = app;
module.exports.io = io;
