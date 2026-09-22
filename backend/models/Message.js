const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
        type: String,
    },
    imageOrVideoUrl: {
        type: String,
    },
    contentType: {
        type: String,
        // "file" covers any non-media attachment (pdf, docx, zip, …) and is rendered as a file
        // card rather than a preview.
        enum: ["text", "image", "video", "file", "audio", "location"],
    },
    // Original name/size/type of an attachment. Without this a file card would only be able to
    // show a Cloudinary URL, which tells the recipient nothing.
    fileMeta: {
      name: { type: String },
      size: { type: Number },
      mimeType: { type: String },
      // Audio only, in seconds — lets a voice note show its duration without downloading it.
      duration: { type: Number },
    },
    // Shared location. Stored as numbers rather than a string so the client can build a map link
    // and the values stay machine-readable.
    location: {
      lat: { type: Number },
      lng: { type: Number },
      label: { type: String },
    },
    // Quote / reply. Refers to another Message; may dangle if that message is later deleted,
    // so the UI has to tolerate a null populate.
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    // Shown as a "Forwarded" label, following WhatsApp convention.
    isForwarded: {
      type: Boolean,
      default: false,
    },
    reactions: [{
        user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        },
        emoji: {
        type: String,
        },
   }],
   messageStatus: {
    type: String,
    default: "sent",
    enum: ["sent", "delivered", "read"],
   }
  },
    { timestamps: true }

);

// Both fetching a conversation's history and searching it filter on `conversation`, then order by
// time — so a compound index serves both. (A Mongo text index was the obvious alternative, but it
// matches whole words only, and chat search needs substring matching.)
messageSchema.index({ conversation: 1, createdAt: -1 });

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;
