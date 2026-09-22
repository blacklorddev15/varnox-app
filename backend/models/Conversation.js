const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],
    // A conversation is a 1-to-1 chat unless isGroup is set. Groups reuse `participants` as the
    // member list, so existing pairwise lookups keep working unchanged.
    isGroup: {
        type: Boolean,
        default: false,
    },
    name: {
        type: String,
        trim: true,
        maxlength: 60,
    },
    groupIcon: {
        type: String,
    },
    // Group admins. Empty for 1-to-1 conversations.
    admins: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    },
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
    },
    unreadCount: {
        type: Number,
        default: 0,
    },
  },
  { timestamps: true });

// Listing a user's conversations filters on membership and sorts by recency, so index that.
conversationSchema.index({ participants: 1, updatedAt: -1 });

const Conversation = mongoose.model("Conversation", conversationSchema);
module.exports = Conversation;
