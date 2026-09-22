import React, { useState, useEffect, useRef } from "react";
import {
  FaArrowLeft,
  FaSmile,
  FaPaperclip,
  FaMicrophone,
  FaPaperPlane,
  FaLock,
  FaCheck,
  FaCheckDouble,
  FaImage,
  FaVideo,
  FaTimes,
  FaEllipsisV,
  FaTrash,
  FaExclamationCircle,
  FaFileAlt,
  FaPhoneAlt,
  FaReply,
  FaShare,
} from "react-icons/fa";
import useUserStore from "../../store/useUserStore";
import useChatStore from "../../store/useChatStore";
import useLayoutStore from "../../store/useLayoutStore";
import { getAvatarUrl } from "../../utils/avatarUtil";
import { toast } from "react-toastify";
import { getCallConfig, ensureCallInit } from "../../services/trtc.service";
import { forwardMessage as forwardMessageApi } from "../../services/chat.api";

// Varnox Delivery Status Ticks
const StatusTick = ({ status }) => {
  if (status === "read") return <FaCheckDouble className="w-3 h-3 text-[#53bdeb]" title="Read" />;
  if (status === "delivered") return <FaCheckDouble className="w-3 h-3 text-[#8696a0]" title="Delivered" />;
  if (status === "failed") return <FaExclamationCircle className="w-3 h-3 text-red-500" title="Failed to send" />;
  return <FaCheck className="w-3 h-3 text-[#8696a0]" title="Sent" />;
};

// Curated Varnox Emojis for the popup picker
const EMOJI_CATEGORIES = {
  "Smileys & People": [
    "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇",
    "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😋", "😛",
    "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨",
    "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔",
    "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵",
    "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓", "🧐", "😕",
  ],
  "Gestures & Body": [
    "👍", "👎", "👌", "🤌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈",
    "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👋", "🤝",
    "🙏", "💪", "👏", "🙌", "👐", "🤲", "🤜", "🤛", "✊", "👊",
  ],
  "Hearts & Symbols": [
    "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
    "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "✨", "🔥",
    "🎉", "🎊", "⭐", "🌟", "💯", "💢", "💥", "💫", "💬", "💭",
  ],
};

const ChatWindow = () => {
  // Global Store States
  const { user: currentUser } = useUserStore();
  const { selectedContact, clearSelectedContact } = useLayoutStore();

  const {
    messages,
    isLoadingMessages,
    conversations,
    selectedConversation,
    setSelectedConversation,
    fetchMessages,
    fetchConversations,
    sendMessage,
    startTyping,
    stopTyping,
    isUserOnline,
    getUserLastSeen,
    isUserTyping,
    deleteMessage,
    addReaction,
  } = useChatStore();

  // Local States [1:09:50 - 1:13:28]
  const [message, setMessage] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [filePreview, setFilePreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [activeCategory, setActiveCategory] = useState("Smileys & People");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [sending, setSending] = useState(false);

  // --- Reply / forward -----------------------------------------------------------------------
  const [replyingTo, setReplyingTo] = useState(null);
  const [forwardingMsg, setForwardingMsg] = useState(null);
  const [forwarding, setForwarding] = useState(false);

  // --- Calling (TRTC) ---------------------------------------------------------------------
  // Inert unless the SERVER reports that TRTC is configured. With no credentials the buttons
  // never render, so the chat screen behaves exactly as it did before calls existed.
  const [callConfig, setCallConfig] = useState({ enabled: false });

  useEffect(() => {
    let cancelled = false;
    getCallConfig().then((cfg) => {
      if (!cancelled) setCallConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const startCall = async (wantVideo) => {
    if (!selectedContact?._id) return;
    try {
      // Init already happened at app level (App.jsx), which is what makes receiving calls
      // possible at all. ensureCallInit returns the cached instance, or performs the init if this
      // runs before that effect — so placing a call works either way.
      const trtc = await ensureCallInit();

      await trtc.TUICallKitAPI.calls({
        userID: selectedContact._id,
        type: wantVideo ? trtc.CallMediaType.VIDEO : trtc.CallMediaType.AUDIO,
      });
    } catch (err) {
      // Never let a call failure take down the chat screen.
      console.error("Could not start call:", err?.message || err);
      toast.error(err?.message || "Could not start the call");
    }
  };

  // DOM & Timing Refs
  const typingTimeoutRef = useRef(null);
  const messageEndRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const fileMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const textInputRef = useRef(null);
  const loadedContactIdRef = useRef(null);
  const loadedConvIdRef = useRef(null);

  // Responsive mobile resize listener
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Fetching Messages on Contact Selection
  useEffect(() => {
    if (!selectedContact?._id || !currentUser?._id) return;

    const contactIdStr = selectedContact._id?.toString();
    const isDifferentContact = loadedContactIdRef.current !== contactIdStr;
    if (isDifferentContact) {
      loadedContactIdRef.current = contactIdStr;
      loadedConvIdRef.current = null;
    }

    const convList = Array.isArray(conversations) ? conversations : conversations?.data || [];
    const matchedConv = convList.find((c) =>
      c.participants?.some((p) => (p._id || p)?.toString() === contactIdStr)
    );

    const matchedConvId = matchedConv?._id?.toString() || null;

    if (matchedConv) {
      if (loadedConvIdRef.current !== matchedConvId) {
        loadedConvIdRef.current = matchedConvId;
        setSelectedConversation(matchedConv);
      }
    } else {
      if (isDifferentContact || loadedConvIdRef.current !== null) {
        loadedConvIdRef.current = null;
        setSelectedConversation(null);
      }
    }
  }, [selectedContact?._id, conversations]);

  // Auto-scroll to bottom of message feed
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Typing Indicator Debounce Hook
  useEffect(() => {
    if (!selectedContact?._id) return;

    if (!message.trim()) {
      stopTyping(selectedContact._id, selectedConversation?._id);
      return;
    }

    startTyping(selectedContact._id, selectedConversation?._id);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      stopTyping(selectedContact._id, selectedConversation?._id);
    }, 2000);

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [message, selectedContact?._id, selectedConversation?._id]);

  // Outside click listener for emoji picker and file menu
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target)) {
        setShowFileMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // File Selection Handler
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setShowFileMenu(false);
    setFilePreview(URL.createObjectURL(file));
  };

  const clearFile = () => {
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Message Dispatch Handler
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if ((!message.trim() && !selectedFile) || !selectedContact?._id || !currentUser?._id) return;

    setSending(true);

    const isOnline = isUserOnline(selectedContact._id);
    const formData = new FormData();
    formData.append("senderId", currentUser._id);
    formData.append("receiverId", selectedContact._id);
    formData.append("messageStatus", isOnline ? "delivered" : "sent");

    if (message.trim()) {
      formData.append("content", message.trim());
    }

    if (selectedFile) {
      formData.append("media", selectedFile);
      formData.append("file", selectedFile);
    }

    // Quote / reply. The server independently verifies the target message belongs to this
    // conversation, so a tampered request cannot quote from someone else's chat.
    if (replyingTo?._id) {
      formData.append("replyToId", replyingTo._id);
    }

    // Flush local inputs immediately
    setMessage("");
    clearFile();
    setReplyingTo(null);
    setShowEmojiPicker(false);
    setShowFileMenu(false);

    try {
      await sendMessage(formData);
      fetchConversations();
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  };

  const handleForward = async (conversation) => {
    if (!forwardingMsg || !conversation) return;

    // Conversations are pairwise, so the target is whichever participant is not the current user.
    // Tolerates participants being either populated objects or raw ids.
    const other = conversation.participants?.find(
      (p) => (p._id || p).toString() !== currentUser?._id?.toString()
    );
    const receiverId = other?._id || other;

    if (!receiverId) {
      toast.error("Could not work out who to forward to");
      return;
    }

    setForwarding(true);
    try {
      await forwardMessageApi({ messageId: forwardingMsg._id, receiverId });
      toast.success("Message forwarded");
      setForwardingMsg(null);
      fetchConversations();
    } catch (err) {
      toast.error(err?.message || "Could not forward the message");
    } finally {
      setForwarding(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleEmojiSelect = (emoji) => {
    setMessage((prev) => prev + emoji);
    textInputRef.current?.focus();
  };

  const formatTime = (date) =>
    new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const formatDate = (date) => {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  };

  const groupedMessages = messages.reduce((groups, msg) => {
    const label = formatDate(msg.createdAt);
    if (!groups[label]) groups[label] = [];
    groups[label].push(msg);
    return groups;
  }, {});

  const isContactOnline = isUserOnline(selectedContact?._id) || selectedContact?.isOnline;
  const lastSeenDate = getUserLastSeen(selectedContact?._id) || selectedContact?.lastSeen;
  const isContactTyping = isUserTyping(selectedContact?._id, selectedConversation?._id);

  return (
    <div className="h-full flex flex-col bg-[#efeae2] dark:bg-[#0b141a] transition-colors relative">
      {/* The call overlay is mounted at the app root (App.jsx) so an incoming call can appear
          over any screen, not only an open chat. */}

      {/* 1. Header Bar */}
      <div className="h-16 px-4 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#e9edef] dark:border-[#222e35] flex items-center justify-between flex-shrink-0 z-20 select-none">
        <div className="flex items-center gap-3">
          {isMobile && (
            <button
              onClick={clearSelectedContact}
              className="p-2 -ml-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 text-[#54656f] dark:text-[#aebac1]"
            >
              <FaArrowLeft className="w-4 h-4" />
            </button>
          )}

          <div className="relative">
            <img
              src={getAvatarUrl(selectedContact, selectedContact?.username)}
              alt={selectedContact?.username}
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = getAvatarUrl(null, selectedContact?.username);
              }}
              className="w-10 h-10 rounded-full object-cover bg-gray-200 dark:bg-gray-700 cursor-pointer"
            />
            {isContactOnline && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#25d366] rounded-full border-2 border-white dark:border-[#202c33]" />
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef] leading-tight">
              {selectedContact?.username}
            </h2>
            <span className="text-[11px] text-[#54656f] dark:text-[#8696a0] transition-colors">
              {isContactTyping ? (
                <span className="text-[#00a884] font-medium animate-pulse">typing...</span>
              ) : isContactOnline ? (
                <span className="text-[#00a884] font-medium">online</span>
              ) : lastSeenDate ? (
                `last seen ${formatTime(lastSeenDate)}`
              ) : (
                "offline"
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[#54656f] dark:text-[#aebac1]">
          {/* Rendered only when the server reports TRTC is configured. */}
          {callConfig.enabled && (
            <>
              <button
                onClick={() => startCall(true)}
                title="Video call"
                aria-label="Video call"
                className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <FaVideo className="w-4 h-4" />
              </button>
              <button
                onClick={() => startCall(false)}
                title="Voice call"
                aria-label="Voice call"
                className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <FaPhoneAlt className="w-4 h-4" />
              </button>
            </>
          )}
          <button className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <FaEllipsisV className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Message Stream Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-12 py-4 space-y-1 relative select-text">
        {isLoadingMessages ? (
          <div className="h-full flex flex-col items-center justify-center text-[#8696a0]">
            <div className="w-8 h-8 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin mb-3" />
            <span className="text-xs">Loading messages...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[#8696a0] opacity-80 select-none">
            <div className="p-4 bg-white/80 dark:bg-[#182229]/80 backdrop-blur rounded-xl shadow-sm text-center max-w-sm">
              <FaLock className="w-4 h-4 mx-auto mb-2 text-[#00a884]" />
              <p className="text-xs">
                Messages are end-to-end encrypted. No one outside of this chat can read them.
              </p>
            </div>
          </div>
        ) : (
          Object.entries(groupedMessages).map(([dateLabel, dayMessages]) => (
            <div key={dateLabel}>
              <div className="flex items-center justify-center my-4 select-none">
                <span className="px-3 py-1 text-[11px] font-medium text-[#54656f] dark:text-[#8696a0] bg-white dark:bg-[#182229] rounded-full shadow-sm">
                  {dateLabel}
                </span>
              </div>

              {dayMessages.map((msg) => {
                const isMine = (msg.sender?._id || msg.sender)?.toString() === currentUser?._id?.toString();

                return (
                  <div
                    key={msg._id || msg.tempId}
                    className={`flex mb-2 group relative ${isMine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`relative max-w-[72%] rounded-lg px-3 pt-2 pb-2 shadow-sm ${
                        isMine
                          ? "bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-none"
                          : "bg-white dark:bg-[#202c33] rounded-tl-none"
                      }`}
                    >
                      {/* Forwarded badge */}
                      {msg.isForwarded && (
                        <div className="flex items-center gap-1 mb-1 text-[11px] italic text-[#8696a0]">
                          <FaShare className="w-3 h-3" />
                          Forwarded
                        </div>
                      )}

                      {/* Quoted message. Tolerates a null replyTo — the original may have been
                          deleted — and falls back to a label for non-text messages. */}
                      {msg.replyTo && (
                        <div
                          className={`mb-1.5 rounded-md border-l-4 px-2 py-1 ${
                            isMine
                              ? "border-[#06cf9c] bg-black/5 dark:bg-black/20"
                              : "border-[#00a884] bg-black/5 dark:bg-black/20"
                          }`}
                        >
                          <p className="text-[11px] font-medium text-[#00a884]">
                            {msg.replyTo.sender?.username || "Message"}
                          </p>
                          <p className="text-[12px] truncate text-[#667781] dark:text-[#8696a0]">
                            {msg.replyTo.content ||
                              (msg.replyTo.contentType === "image"
                                ? "Photo"
                                : msg.replyTo.contentType === "video"
                                  ? "Video"
                                  : msg.replyTo.contentType === "file"
                                    ? msg.replyTo.fileMeta?.name || "Document"
                                    : "Message unavailable")}
                          </p>
                        </div>
                      )}

                      {/* Generic file attachment — a card with name/size, never a broken image. */}
                      {msg.contentType === "file" && msg.imageOrVideoUrl && (
                        <a
                          href={msg.imageOrVideoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mb-1.5 flex items-center gap-2.5 rounded-md bg-black/5 px-2.5 py-2 transition-colors hover:bg-black/10 dark:bg-black/20 dark:hover:bg-black/30"
                        >
                          <FaFileAlt className="w-6 h-6 shrink-0 text-[#00a884]" />
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] text-[#111b21] dark:text-[#e9edef]">
                              {msg.fileMeta?.name || "Attachment"}
                            </span>
                            {msg.fileMeta?.size ? (
                              <span className="block text-[11px] text-[#8696a0]">
                                {(msg.fileMeta.size / 1024).toFixed(1)} KB · tap to download
                              </span>
                            ) : null}
                          </span>
                        </a>
                      )}

                      {/* Media Image / Video Attachment (file cards render above instead) */}
                      {msg.imageOrVideoUrl && msg.contentType !== "file" && (
                        <div className="mb-1.5 overflow-hidden rounded-md">
                          {msg.contentType === "video" ? (
                            <video
                              src={msg.imageOrVideoUrl}
                              controls
                              className="rounded-md max-h-64 w-full object-cover"
                            />
                          ) : (
                            <img
                              src={msg.imageOrVideoUrl}
                              alt="attachment"
                              className="rounded-md max-h-64 w-auto object-cover cursor-pointer hover:opacity-95 transition-opacity"
                              onClick={() => window.open(msg.imageOrVideoUrl, "_blank")}
                            />
                          )}
                        </div>
                      )}

                      {/* Text content */}
                      {msg.content && (
                        <p className="text-[13.5px] leading-snug text-[#111b21] dark:text-[#e9edef] break-words whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      )}

                      {/* Timestamp and Status Ticks */}
                      <div className="flex items-center justify-end gap-1 mt-0.5 select-none">
                        <span className="text-[10px] text-[#8696a0]">
                          {formatTime(msg.createdAt)}
                        </span>
                        {isMine && <StatusTick status={msg.messageStatus} />}
                      </div>

                      {/* Reactions Badges */}
                      {msg.reactions && msg.reactions.length > 0 && (
                        <div className="absolute -bottom-2.5 right-2 flex items-center gap-0.5 px-1.5 py-0.5 bg-white dark:bg-[#1f2c34] border border-gray-100 dark:border-[#2a3942] rounded-full shadow-sm text-xs select-none">
                          {Array.from(new Set(msg.reactions.map((r) => r.emoji))).slice(0, 3).map((em, idx) => (
                            <span key={idx}>{em}</span>
                          ))}
                          {msg.reactions.length > 1 && (
                            <span className="text-[10px] text-[#8696a0] font-medium ml-0.5">
                              {msg.reactions.length}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Hover Action Toolbar: Quick Reactions & Delete */}
                      <div className="absolute -top-3.5 right-1 hidden group-hover:flex items-center gap-1 bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#2a3942] rounded-full px-1.5 py-0.5 shadow-md z-10">
                        {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => addReaction(msg._id, emoji)}
                            className="text-xs hover:scale-125 transition-transform px-0.5"
                            title={`React with ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}

                        <button
                          onClick={() => setReplyingTo(msg)}
                          className="p-1 text-[#8696a0] hover:text-[#00a884] transition-colors"
                          title="Reply"
                        >
                          <FaReply className="w-2.5 h-2.5" />
                        </button>

                        <button
                          onClick={() => setForwardingMsg(msg)}
                          className="p-1 text-[#8696a0] hover:text-[#00a884] transition-colors"
                          title="Forward"
                        >
                          <FaShare className="w-2.5 h-2.5" />
                        </button>

                        {isMine && (
                          <button
                            onClick={() => deleteMessage(msg._id)}
                            className="p-1 text-red-400 hover:text-red-600 transition-colors ml-0.5"
                            title="Delete message"
                          >
                            <FaTrash className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}

        <div ref={messageEndRef} />
      </div>

      {/* 3. Media Preview Strip */}
      {filePreview && (
        <div className="px-4 py-2.5 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#e9edef] dark:border-[#222e35] flex items-center gap-3 z-20">
          <div className="relative">
            {selectedFile?.type?.startsWith("video") ? (
              <div className="w-14 h-14 bg-black rounded-lg flex items-center justify-center text-white">
                <FaVideo className="w-6 h-6 text-[#00a884]" />
              </div>
            ) : (
              <img src={filePreview} alt="preview" className="h-14 w-14 object-cover rounded-lg shadow-sm" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[#111b21] dark:text-[#e9edef] truncate">
              {selectedFile?.name}
            </p>
            <p className="text-[10px] text-[#8696a0]">
              {(selectedFile?.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
          <button
            type="button"
            onClick={clearFile}
            className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[#8696a0] hover:text-[#111b21] dark:hover:text-white"
            title="Remove attachment"
          >
            <FaTimes className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4. Emoji Picker Dropdown */}
      {showEmojiPicker && (
        <div
          ref={emojiPickerRef}
          className="absolute bottom-16 left-4 w-80 max-h-80 bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#2a3942] rounded-2xl shadow-2xl z-30 flex flex-col overflow-hidden"
        >
          {/* Category Tabs */}
          <div className="flex border-b border-gray-100 dark:border-[#2a3942] p-1.5 gap-1 bg-gray-50 dark:bg-[#182229]">
            {Object.keys(EMOJI_CATEGORIES).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`flex-1 py-1 text-[11px] font-medium rounded-lg transition-colors truncate ${
                  activeCategory === cat
                    ? "bg-[#075e54] text-white"
                    : "text-[#54656f] dark:text-[#8696a0] hover:bg-gray-200/60 dark:hover:bg-white/5"
                }`}
              >
                {cat.split(" ")[0]}
              </button>
            ))}
          </div>

          {/* Emoji Grid */}
          <div className="flex-1 overflow-y-auto p-3 grid grid-cols-8 gap-2">
            {EMOJI_CATEGORIES[activeCategory].map((emoji, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleEmojiSelect(emoji)}
                className="text-lg hover:scale-125 transition-transform flex items-center justify-center p-1 rounded hover:bg-gray-100 dark:hover:bg-white/5"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 5. Attachment Popup Menu */}
      {showFileMenu && (
        <div
          ref={fileMenuRef}
          className="absolute bottom-16 left-12 w-48 bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#2a3942] rounded-xl shadow-xl z-30 p-2 space-y-1"
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#182229] text-[#111b21] dark:text-[#e9edef] transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-purple-500 text-white flex items-center justify-center">
              <FaImage className="w-3.5 h-3.5" />
            </div>
            <span>Photos & Videos</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#182229] text-[#111b21] dark:text-[#e9edef] transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center">
              <FaFileAlt className="w-3.5 h-3.5" />
            </div>
            <span>Document</span>
          </button>
        </div>
      )}

      {/* Hidden File Input.
          No `accept` filter any more: arbitrary documents are supported and render as file cards. */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Reply preview — shown while composing a reply. */}
      {replyingTo && (
        <div className="px-3 py-2 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#e9edef] dark:border-[#222e35] flex items-center gap-3 z-20">
          <div className="flex-1 min-w-0 border-l-4 border-[#00a884] bg-black/5 dark:bg-black/20 rounded-md px-2.5 py-1.5">
            <p className="text-[11px] font-medium text-[#00a884]">
              Replying to {replyingTo.sender?.username || "message"}
            </p>
            <p className="text-[12px] truncate text-[#667781] dark:text-[#8696a0]">
              {replyingTo.content ||
                (replyingTo.contentType === "image"
                  ? "Photo"
                  : replyingTo.contentType === "video"
                    ? "Video"
                    : replyingTo.contentType === "file"
                      ? replyingTo.fileMeta?.name || "Document"
                      : "Message")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[#8696a0] hover:text-[#111b21] dark:hover:text-white"
            title="Cancel reply"
          >
            <FaTimes className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Forward picker. Conversations are pairwise, so each row is one contact. */}
      {forwardingMsg && (
        <div className="absolute inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-[#111b21] shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e9edef] dark:border-[#222e35] flex items-center justify-between">
              <p className="font-medium text-[#111b21] dark:text-[#e9edef]">Forward to…</p>
              <button
                type="button"
                onClick={() => setForwardingMsg(null)}
                className="p-1.5 rounded-full text-[#8696a0] hover:bg-black/10 dark:hover:bg-white/10"
                title="Cancel"
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {conversations?.length ? (
                conversations.map((c) => {
                  const other = c.participants?.find(
                    (p) => (p._id || p).toString() !== currentUser?._id?.toString()
                  );
                  const name = other?.username || "Unknown contact";

                  return (
                    <button
                      key={c._id}
                      type="button"
                      disabled={forwarding}
                      onClick={() => handleForward(c)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                    >
                      {other?.profilePicture ? (
                        <img
                          src={getAvatarUrl(other.profilePicture)}
                          alt=""
                          className="w-9 h-9 rounded-full object-cover"
                        />
                      ) : (
                        <span className="w-9 h-9 rounded-full bg-[#00a884]/15 text-[#00a884] flex items-center justify-center text-sm font-medium">
                          {name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="text-[14px] text-[#111b21] dark:text-[#e9edef] truncate">
                        {name}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="px-4 py-6 text-center text-sm text-[#8696a0]">
                  No conversations to forward to yet
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. Footer Input Bar */}
      <form
        onSubmit={handleSendMessage}
        className="min-h-[62px] px-3 py-2 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#e9edef] dark:border-[#222e35] flex items-center gap-2 flex-shrink-0 z-20"
      >
        <button
          type="button"
          onClick={() => {
            setShowEmojiPicker((prev) => !prev);
            setShowFileMenu(false);
          }}
          className={`p-2 rounded-full transition-colors ${
            showEmojiPicker ? "text-[#00a884] bg-black/5 dark:bg-white/5" : "text-[#54656f] dark:text-[#8696a0] hover:text-[#00a884]"
          }`}
          title="Emoji"
        >
          <FaSmile className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => {
            setShowFileMenu((prev) => !prev);
            setShowEmojiPicker(false);
          }}
          className={`p-2 rounded-full transition-colors ${
            showFileMenu ? "text-[#00a884] bg-black/5 dark:bg-white/5" : "text-[#54656f] dark:text-[#8696a0] hover:text-[#00a884]"
          }`}
          title="Attach"
        >
          <FaPaperclip className="w-5 h-5" />
        </button>

        <div className="flex-1">
          <input
            ref={textInputRef}
            type="text"
            placeholder="Type a message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-10 px-4 bg-white dark:bg-[#2a3942] text-sm text-[#111b21] dark:text-[#e9edef] placeholder-[#8696a0] rounded-lg outline-none transition-colors"
          />
        </div>

        {message.trim() || selectedFile ? (
          <button
            type="submit"
            disabled={sending}
            className="p-2.5 rounded-full bg-[#00a884] hover:bg-[#02906f] active:bg-[#075e54] text-white shadow-md transition-all hover:scale-105 disabled:opacity-50"
            title="Send"
          >
            <FaPaperPlane className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            className="p-2 text-[#54656f] dark:text-[#8696a0] hover:text-[#00a884] transition-colors"
            title="Voice message"
          >
            <FaMicrophone className="w-5 h-5" />
          </button>
        )}
      </form>
    </div>
  );
};

export default ChatWindow;
