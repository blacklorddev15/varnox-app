const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const trtcController = require("../controllers/trtcController");

const router = express.Router();

// Both routes require a session. In particular the UserSig must be tied to an authenticated
// user, or it would be a way to impersonate anyone on a call.
router.get("/config", authMiddleware, trtcController.getConfig);
router.get("/usersig", authMiddleware, trtcController.getUserSig);

module.exports = router;
