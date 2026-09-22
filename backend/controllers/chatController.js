const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { uploadOnCloudinary } = require("../config/cloudinaryConfig");
const response = require("../utils/responseHandler");

exports.sendMessage = async (req, res) => {
  try {
    const {
      senderId,
      receiverId,
      content,
      messageStatus,
      replyToId,
      isForwarded,
      // Voice notes: MediaRecorder reports audio-only recordings as video/webm in most browsers,
      // so the client sends this hint. Without it a voice note would be filed as a video.
      messageType,
      duration,
      // Shared location
      lat,
      lng,
      label,
    } = req.body;
    const effectiveSenderId = senderId || req.user?._id;
    const file = req.file;

    if (!effectiveSenderId || !receiverId) {
      return response(res, 400, "Sender and receiver IDs are required");
    }

    let conversation = await Conversation.findOne({
      participants: { $all: [effectiveSenderId, receiverId] },
    });

    if (!conversation) {
      conversation = new Conversation({
        participants: [effectiveSenderId, receiverId],
        lastMessage: null,
        unreadCount: 0,
      });
      await conversation.save();
    }

    let imageOrVideoUrl = null;
    let contentType = "text";
    let fileMeta;

    if (file) {
      const uploadResult = await uploadOnCloudinary(file);
      if (!uploadResult?.secure_url) {
        return response(res, 400, "File upload failed");
      }
      imageOrVideoUrl = uploadResult.secure_url;

      const wantsAudio = messageType === "audio";

      if (file.mimetype?.startsWith("image/")) {
        contentType = "image";
      } else if (file.mimetype?.startsWith("audio/")) {
        contentType = "audio";
      } else if (file.mimetype?.startsWith("video/")) {
        contentType = wantsAudio ? "audio" : "video";
      } else {
        // Anything else is accepted as a generic attachment and shown as a file card. The old
        // code rejected every non image/video type outright.
        contentType = "file";
      }

      const durationNum = Number(duration);

      fileMeta = {
        name: file.originalname || null,
        size: file.size || null,
        mimeType: file.mimetype || null,
        duration: Number.isFinite(durationNum) && durationNum > 0 ? Math.round(durationNum) : undefined,
      };
    } else if (!content?.trim() && !(lat !== undefined && lng !== undefined)) {
      // Coordinates count as content: a location message legitimately carries no text and no file.
      return response(res, 400, "Message content or file is required");
    }

    // Shared location. Validated here rather than trusted, since coordinates come straight from
    // the client and out-of-range values would break any map the recipient renders.
    let location;
    if (contentType === "text" && !file && lat !== undefined && lng !== undefined) {
      const latNum = Number(lat);
      const lngNum = Number(lng);

      if (
        !Number.isFinite(latNum) ||
        !Number.isFinite(lngNum) ||
        Math.abs(latNum) > 90 ||
        Math.abs(lngNum) > 180
      ) {
        return response(res, 400, "Invalid location coordinates");
      }

      contentType = "location";
      location = {
        lat: latNum,
        lng: lngNum,
        label: label ? String(label).slice(0, 120) : null,
      };
    }

    // A reply must point at a message in THIS conversation. Without that check a crafted request
    // could quote a message from someone else's private chat.
    let replyTo = null;
    if (replyToId) {
      const quoted = await Message.findOne({
        _id: replyToId,
        conversation: conversation._id,
      }).select("_id");

      if (!quoted) {
        return response(res, 400, "The message being replied to is not in this conversation");
      }
      replyTo = quoted._id;
    }

    const message = new Message({
      conversation: conversation._id,
      sender: effectiveSenderId,
      receiver: receiverId,
      content: content || null,
      contentType: contentType,
      imageOrVideoUrl: imageOrVideoUrl,
      fileMeta,
      location,
      replyTo,
      isForwarded: isForwarded === true || isForwarded === "true",
      messageStatus: messageStatus || "sent",
    });
    await message.save();

    conversation.lastMessage = message._id;
    conversation.unreadCount += 1;
    await conversation.save();

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "username profilePicture")
      .populate("receiver", "username profilePicture")
      // Include just enough of the quoted message to render a preview. A deleted original simply
      // populates to null, which the UI has to tolerate.
      .populate({
        path: "replyTo",
        select: "content contentType imageOrVideoUrl fileMeta location sender",
        populate: { path: "sender", select: "username" },
      });

    if (req.io && req.socketUserMap) {
      const receiverSocketId = req.socketUserMap.get(receiverId?.toString());
      if (receiverSocketId) {
        req.io.to(receiverSocketId).emit("receiveMessage", populatedMessage);
        message.messageStatus = "delivered";
        await message.save();
      }
    }

    return response(res, 201, "Message sent successfully", populatedMessage);
  } catch (error) {
    console.error("Error sending message:", error);
    return response(res, 500, "Failed to send message", { error: error.message });
  }
};

exports.getConversations = async (req, res) => {
  const userId = req.user?._id || req.user?.userId;
  try {
    const conversations = await Conversation.find({
      participants: userId,
    })
      .populate("participants", "username profilePicture isOnline lastSeen")
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender receiver",
          select: "username profilePicture",
        },
      })
      .sort({ updatedAt: -1 });

    return response(res, 200, "Conversations fetched successfully", conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return response(res, 500, "Failed to fetch conversations", { error: error.message });
  }
};

exports.getMessages = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user?._id || req.user?.userId;
  try {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return response(res, 404, "Conversation not found");
    }
    if (!conversation.participants.map((p) => p.toString()).includes(userId.toString())) {
      return response(res, 403, "You are not a participant in this conversation");
    }

    const messages = await Message.find({ conversation: conversationId })
      .populate("sender", "username profilePicture")
      .populate("receiver", "username profilePicture")
      .populate("reactions.user", "username profilePicture")
      .populate({
        path: "replyTo",
        select: "content contentType imageOrVideoUrl fileMeta location sender",
        populate: { path: "sender", select: "username" },
      })
      .sort({ createdAt: 1 });

    await Message.updateMany(
      { conversation: conversationId, receiver: userId, messageStatus: { $ne: "read" } },
      { $set: { messageStatus: "read" } }
    );

    conversation.unreadCount = 0;
    await conversation.save();

    return response(res, 200, "Messages fetched successfully", messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return response(res, 500, "Failed to fetch messages", { error: error.message });
  }
};

exports.markMessagesAsRead = async (req, res) => {
  const { messageIds, conversationId } = req.body;
  const userId = req.user?._id || req.user?.userId;

  try {
    const filter = {
      receiver: userId,
      messageStatus: { $ne: "read" },
    };

    if (Array.isArray(messageIds) && messageIds.length > 0) {
      filter._id = { $in: messageIds };
    } else if (conversationId) {
      filter.conversation = conversationId;
    } else {
      return response(res, 400, "messageIds or conversationId is required");
    }

    const messagesToUpdate = await Message.find(filter);
    await Message.updateMany(filter, { $set: { messageStatus: "read" } });

    if (conversationId) {
      await Conversation.findByIdAndUpdate(conversationId, { unreadCount: 0 });
    }

    if (req.io && req.socketUserMap) {
      messagesToUpdate.forEach((msg) => {
        const senderSocketId = req.socketUserMap.get(msg.sender.toString());
        if (senderSocketId) {
          const payload = {
            messageId: msg._id,
            _id: msg._id,
            conversationId: msg.conversation,
            messageStatus: "read",
          };
          req.io.to(senderSocketId).emit("message_status_update", payload);
          req.io.to(senderSocketId).emit("messageRead", payload);
        }
      });
    }

    return response(res, 200, "Messages marked as read successfully", {
      count: messagesToUpdate.length,
      updatedIds: messagesToUpdate.map((m) => m._id),
    });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    return response(res, 500, "Failed to mark messages as read", { error: error.message });
  }
};

exports.markAsRead = async (req, res) => {
  const { messageId } = req.body;
  const userId = req.user?._id || req.user?.userId;
  try {
    const message = await Message.findById(messageId);
    if (!message) {
      return response(res, 404, "Message not found");
    }
    if (message.receiver.toString() !== userId.toString()) {
      return response(res, 403, "You are not the receiver of this message");
    }

    message.messageStatus = "read";
    await message.save();

    if (req.io && req.socketUserMap) {
      const senderSocketId = req.socketUserMap.get(message.sender.toString());
      if (senderSocketId) {
        const payload = {
          messageId: message._id,
          _id: message._id,
          conversationId: message.conversation,
          messageStatus: "read",
        };
        req.io.to(senderSocketId).emit("message_status_update", payload);
        req.io.to(senderSocketId).emit("messageRead", payload);
      }
    }

    return response(res, 200, "Message marked as read successfully", message);
  } catch (error) {
    console.error("Error marking message as read:", error);
    return response(res, 500, "Failed to mark message as read", { error: error.message });
  }
};

exports.deleteMessage = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user?._id || req.user?.userId;
  try {
    const message = await Message.findById(messageId);
    if (!message) {
      return response(res, 404, "Message not found");
    }
    if (message.sender.toString() !== userId.toString()) {
      return response(res, 403, "You are not the sender of this message");
    }

    await message.deleteOne();

    if (req.io && req.socketUserMap) {
      const receiverSocketId = req.socketUserMap.get(message.receiver.toString());
      if (receiverSocketId) {
        req.io.to(receiverSocketId).emit("message_deleted", { deletedMessageId: messageId });
        req.io.to(receiverSocketId).emit("messageDeleted", { deletedMessageId: messageId });
      }
    }

    return response(res, 200, "Message deleted successfully", message);
  } catch (error) {
    console.error("Error deleting message:", error);
    return response(res, 500, "Failed to delete message", { error: error.message });
  }
};

exports.updateMessage = async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;
  const userId = req.user?._id || req.user?.userId;
  const file = req.file;

  try {
    const message = await Message.findById(messageId);
    if (!message) {
      return response(res, 404, "Message not found");
    }
    if (message.sender.toString() !== userId.toString()) {
      return response(res, 403, "You can only edit your own messages");
    }

    if (file) {
      const uploadResult = await uploadOnCloudinary(file);
      if (!uploadResult?.secure_url) {
        return response(res, 400, "File upload failed");
      }
      message.imageOrVideoUrl = uploadResult.secure_url;
    }

    if (content !== undefined) {
      message.content = content;
    }

    await message.save();

    const updatedMessage = await Message.findById(message._id)
      .populate("sender", "username profilePicture")
      .populate("receiver", "username profilePicture");

    return response(res, 200, "Message updated successfully", updatedMessage);
  } catch (error) {
    console.error("Error updating message:", error);
    return response(res, 500, "Failed to update message", { error: error.message });
  }
};

exports.deleteConversation = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user?._id || req.user?.userId;

  try {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return response(res, 404, "Conversation not found");
    }
    if (!conversation.participants.map((p) => p.toString()).includes(userId.toString())) {
      return response(res, 403, "You are not a participant in this conversation");
    }

    await Message.deleteMany({ conversation: conversationId });
    await conversation.deleteOne();
    
    if (req.io && req.socketUserMap) {
      const otherParticipant = conversation.participants.find(p => p.toString() !== userId.toString());
      const receiverSocketId = req.socketUserMap.get(otherParticipant?.toString());
      if (receiverSocketId) {
        req.io.to(receiverSocketId).emit("conversationDeleted", { conversationId });
      }
    }

    return response(res, 200, "Conversation deleted successfully");
  } catch (error) {
    console.error("Error deleting conversation:", error);
    return response(res, 500, "Failed to delete conversation", { error: error.message });
  }
};

exports.searchMessages = async (req, res) => {
  const userId = req.user?._id || req.user?.userId;
  const rawQuery = (req.query.q || "").trim();

  if (!rawQuery) {
    return response(res, 400, "A search query is required");
  }

  try {
    const conversations = await Conversation.find({ participants: userId }).select("_id");
    const conversationIds = conversations.map((c) => c._id);

    // Escape regex metacharacters so a query like "a+b" is matched literally. Unescaped, it would
    // be interpreted as a pattern — potentially expensive, and matching things the user never asked
    // for.
    const safe = rawQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const messages = await Message.find({
      // Scoped to the caller's own conversations. Without this filter, search would be a way to
      // read other people's messages.
      conversation: { $in: conversationIds },
      content: { $regex: safe, $options: "i" },
    })
      .populate("sender", "username profilePicture")
      .populate("receiver", "username profilePicture")
      .sort({ createdAt: -1 })
      .limit(60);

    return response(res, 200, "Search complete", {
      query: rawQuery,
      count: messages.length,
      messages,
    });
  } catch (error) {
    console.error("Error searching messages:", error);
    return response(res, 500, "Failed to search messages", { error: error.message });
  }
};

exports.forwardMessage = async (req, res) => {
  const userId = req.user?._id || req.user?.userId;
  const { messageId, receiverId } = req.body;

  try {
    if (!messageId || !receiverId) {
      return response(res, 400, "messageId and receiverId are required");
    }

    const source = await Message.findById(messageId);
    if (!source) {
      return response(res, 404, "Message not found");
    }

    // The source must come from a conversation the caller is in — otherwise forwarding would
    // double as a way to read a message you were never party to.
    const sourceConversation = await Conversation.findById(source.conversation);
    const isParticipant = sourceConversation?.participants
      .map((p) => p.toString())
      .includes(userId.toString());

    if (!isParticipant) {
      return response(res, 403, "You can only forward messages from your own conversations");
    }

    let conversation = await Conversation.findOne({
      participants: { $all: [userId, receiverId] },
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [userId, receiverId],
        lastMessage: null,
        unreadCount: 0,
      });
    }

    const forwarded = await Message.create({
      conversation: conversation._id,
      sender: userId,
      receiver: receiverId,
      content: source.content || null,
      contentType: source.contentType,
      imageOrVideoUrl: source.imageOrVideoUrl || null,
      fileMeta: source.fileMeta || undefined,
      isForwarded: true,
      messageStatus: "sent",
    });

    conversation.lastMessage = forwarded._id;
    conversation.unreadCount += 1;
    await conversation.save();

    const populated = await Message.findById(forwarded._id)
      .populate("sender", "username profilePicture")
      .populate("receiver", "username profilePicture");

    if (req.io && req.socketUserMap) {
      const receiverSocketId = req.socketUserMap.get(receiverId?.toString());
      if (receiverSocketId) {
        req.io.to(receiverSocketId).emit("receiveMessage", populated);
        forwarded.messageStatus = "delivered";
        await forwarded.save();
      }
    }

    return response(res, 201, "Message forwarded successfully", populated);
  } catch (error) {
    console.error("Error forwarding message:", error);
    return response(res, 500, "Failed to forward message", { error: error.message });
  }
};
