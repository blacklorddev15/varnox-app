// Local development entry point.
//
// On Vercel nothing calls listen() — the platform imports `api/index.js` and drives the
// exported server itself. This file exists purely so `npm run dev` / `npm start` keep working.
const { server } = require("./app");

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log(`Server and Socket.io are running on port ${PORT}`);
});
