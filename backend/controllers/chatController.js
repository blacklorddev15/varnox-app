const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { uploadOnCloudinary } = require("../config/cloudinaryConfig");
const response = require("../utils/responseHandler");

exports.sendMessage = async (req, res) => {
  try {
    const {
      senderId,
      receiverId,
      conversationId,
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
      // @mentions, as user ids supplied by the client's autocomplete and validated below.
      mentions: mentionedIds,
    } = req.body;
    const effectiveSenderId = senderId || req.user?._id;
    const file = req.file;

    if (!effectiveSenderId) {
      return response(res, 400, "Sender is required");
    }

    // A conversation can be addressed two ways:
    //   conversationId — groups, and 1-to-1 once the client knows the id
    //   receiverId     — creates or reuses the pairwise conversation (unchanged behaviour)
    let conversation;

    if (conversationId) {
      conversation = await Conversation.findById(conversationId);

      if (!conversation) {
        return response(res, 404, "Conversation not found");
      }

      // Membership is mandatory. Without this check, anyone could post into any conversation
      // simply by knowing its id.
      const isMember = conversation.participants
        .map((p) => p.toString())
        .includes(effectiveSenderId.toString());

      if (!isMember) {
        return response(res, 403, "You are not a participant in this conversation");
      }
    } else {
      if (!receiverId) {
        return response(res, 400, "Sender and receiver IDs are required");
      }

      conversation = await Conversation.findOne({
        participants: { $all: [effectiveSenderId, receiverId] },
        // Exclude groups: two members of the same group would otherwise have their group hijacked
        // as their private 1-to-1 thread.
        isGroup: { $ne: true },
      });

      if (!conversation) {
        conversation = new Conversation({
          participants: [effectiveSenderId, receiverId],
          lastMessage: null,
          unreadCount: 0,
        });
        await conversation.save();
      }
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

    // For a 1-to-1 message the receiver is simply the other participant, so the client can address
    // a conversation by id without needing to know who the counterpart is. Groups have no receiver.
    let effectiveReceiverId = receiverId || null;

    if (!effectiveReceiverId && !conversation.isGroup) {
      const other = conversation.participants.find(
        (p) => p.toString() !== effectiveSenderId.toString()
      );
      effectiveReceiverId = other || null;
    }

    // Mentions arrive from the client's autocomplete, then are filtered against real membership so
    // a crafted request cannot mention somebody outside the group.
    let mentions = [];

    if (conversation.isGroup && Array.isArray(mentionedIds)) {
      const memberIds = conversation.participants.map((p) => p.toString());
      mentions = mentionedIds.filter((id) => memberIds.includes(String(id)));
    }

    const message = new Message({
      conversation: conversation._id,
      sender: effectiveSenderId,
      receiver: effectiveReceiverId,
      content: content || null,
      contentType: contentType,
      imageOrVideoUrl: imageOrVideoUrl,
      fileMeta,
      location,
      replyTo,
      mentions,
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
      // Groups fan out to every participant except the sender; 1-to-1 stays a single emit.
      const targetIds = conversation.isGroup
        ? conversation.participants
            .map((p) => p.toString())
            .filter((id) => id !== effectiveSenderId.toString())
        : [effectiveReceiverId?.toString()].filter(Boolean);

      let anyDelivered = false;

      targetIds.forEach((id) => {
        const socketId = req.socketUserMap.get(id);
        if (socketId) {
          req.io.to(socketId).emit("receiveMessage", populatedMessage);
          anyDelivered = true;
        }
      });

      // "delivered" is meaningless for a group — with N recipients there is no single state, so
      // groups rely on `readBy` instead.
      if (anyDelivered && !conversation.isGroup) {
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

    const conversation = await Conversation.findById(message.conversation).select(
      "isGroup participants"
    );
    const isGroupMessage = Boolean(conversation?.isGroup);

    if (isGroupMessage) {
      // Any member may mark a group message read, and who read it is tracked separately: a single
      // status field cannot express "read by 3 of 5".
      const isMember = conversation.participants
        .map((p) => p.toString())
        .includes(userId.toString());

      if (!isMember) {
        return response(res, 403, "You are not a participant in this conversation");
      }

      if (!message.readBy.some((id) => id.toString() === userId.toString())) {
        message.readBy.push(userId);
        await message.save();
      }
    } else {
      if (message.receiver?.toString() !== userId.toString()) {
        return response(res, 403, "You are not the receiver of this message");
      }

      message.messageStatus = "read";
      await message.save();
    }

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

/* ---------------------------------------------------------------------------------------------
 * Groups
 *
 * A group is a Conversation with isGroup: true, reusing `participants` as the member list so the
 * existing pairwise queries keep working. Every mutating endpoint below checks membership or admin
 * rights — without those checks, a group id would be enough to rename a group, evict its members,
 * or post into it.
 * -------------------------------------------------------------------------------------------*/

const isMemberOf = (conversation, userId) =>
  conversation.participants.map((p) => p.toString()).includes(userId.toString());

const isAdminOf = (conversation, userId) =>
  conversation.admins.some((a) => a.toString() === userId.toString());

const populateGroup = (id) =>
  Conversation.findById(id)
    .populate("participants", "username profilePicture isOnline lastSeen")
    .populate("admins", "username profilePicture");

exports.createGroup = async (req, res) => {
  const userId = req.user?._id || req.user?.userId;
  const { name, participantIds } = req.body;

  try {
    const groupName = String(name || "").trim();
    if (!groupName) {
      return response(res, 400, "A group name is required");
    }
    if (groupName.length > 60) {
      return response(res, 400, "Group name is too long (60 characters maximum)");
    }

    // Deduplicate and always include the creator, so a malformed request cannot produce a group
    // its own creator is not a member of.
    const members = [
      ...new Set([
        ...(Array.isArray(participantIds) ? participantIds.map(String) : []),
        userId.toString(),
      ]),
    ];

    const found = await User.countDocuments({ _id: { $in: members } });
    if (found !== members.length) {
      return response(res, 400, "One or more selected members do not exist");
    }

    const group = await Conversation.create({
      participants: members,
      isGroup: true,
      name: groupName,
      admins: [userId],
      createdBy: userId,
      unreadCount: 0,
    });

    return response(res, 201, "Group created", await populateGroup(group._id));
  } catch (error) {
    console.error("Error creating group:", error);
    return response(res, 500, "Failed to create group", { error: error.message });
  }
};

exports.updateGroup = async (req, res) => {
  const userId = req.user?._id || req.user?.userId;
  const { groupId } = req.params;
  const { name, groupIcon } = req.body;

  try {
    const group = await Conversation.findOne({ _id: groupId, isGroup: true });
    if (!group) {
      return response(res, 404, "Group not found");
    }
    if (!isAdminOf(group, userId)) {
      return response(res, 403, "Only a group admin can change these details");
    }

    if (name !== undefined) {
      const next = String(name).trim();
      if (!next) {
        return response(res, 400, "Group name cannot be empty");
      }
      group.name = next.slice(0, 60);
    }

    if (groupIcon !== undefined) {
      group.groupIcon = groupIcon || null;
    }

    await group.save();
    return response(res, 200, "Group updated", await populateGroup(group._id));
  } catch (error) {
    console.error("Error updating group:", error);
    return response(res, 500, "Failed to update group", { error: error.message });
  }
};

exports.addParticipants = async (req, res) => {
  const userId = req.user?._id || req.user?.userId;
  const { groupId } = req.params;
  const { participantIds } = req.body;

  try {
    const group = await Conversation.findOne({ _id: groupId, isGroup: true });
    if (!group) {
      return response(res, 404, "Group not found");
    }
    if (!isAdminOf(group, userId)) {
      return response(res, 403, "Only a group admin can add members");
    }

    const current = group.participants.map((p) => p.toString());
    const toAdd = [
      ...new Set(
        (Array.isArray(participantIds) ? participantIds : [])
          .map(String)
          .filter((id) => !current.includes(id))
      ),
    ];

    if (!toAdd.length) {
      return response(res, 400, "Those users are already in the group");
    }

    const found = await User.countDocuments({ _id: { $in: toAdd } });
    if (found !== toAdd.length) {
      return response(res, 400, "One or more selected users do not exist");
    }

    group.participants.push(...toAdd);
    await group.save();

    return response(res, 200, "Members added", await populateGroup(group._id));
  } catch (error) {
    console.error("Error adding members:", error);
    return response(res, 500, "Failed to add members", { error: error.message });
  }
};

exports.removeParticipant = async (req, res) => {
  const userId = req.user?._id || req.user?.userId;
  const { groupId, participantId } = req.params;

  try {
    const group = await Conversation.findOne({ _id: groupId, isGroup: true });
    if (!group) {
      return response(res, 404, "Group not found");
    }

    const target = String(participantId);
    const removingSelf = target === userId.toString();

    // Leaving is always allowed; removing someone else requires admin rights.
    if (!removingSelf && !isAdminOf(group, userId)) {
      return response(res, 403, "Only a group admin can remove members");
    }

    if (!group.participants.map((p) => p.toString()).includes(target)) {
      return response(res, 404, "That user is not in this group");
    }

    const remaining = group.participants.filter((p) => p.toString() !== target);

    if (!remaining.length) {
      // Last member out: the group has no reason to exist.
      await Message.deleteMany({ conversation: group._id });
      await group.deleteOne();
      return response(res, 200, "You left the group and it was removed");
    }

    group.participants = remaining;
    group.admins = group.admins.filter((a) => a.toString() !== target);

    // Never leave a group without an admin, or nobody could rename it or manage members again.
    if (!group.admins.length) {
      group.admins = [remaining[0]];
    }

    await group.save();

    return response(res, 200, removingSelf ? "You left the group" : "Member removed", {
      group: await populateGroup(group._id),
      removedUserId: target,
    });
  } catch (error) {
    console.error("Error removing member:", error);
    return response(res, 500, "Failed to remove member", { error: error.message });
  }
};

exports.leaveGroup = async (req, res) => {
  req.params.participantId = (req.user?._id || req.user?.userId).toString();
  return exports.removeParticipant(req, res);
};
