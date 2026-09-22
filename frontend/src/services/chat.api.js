import axiosInstance from "./url.service";

// RESTful conversation endpoints matching tutorial spec
export const getConversations = async () => {
  try {
    const res = await axiosInstance.get("/chats/conversations");
    return res.data;
  } catch {
    const fallback = await axiosInstance.get("/chat/get-conversations");
    return fallback.data;
  }
};

export const getMessages = async (conversationId) => {
  try {
    const res = await axiosInstance.get(`/chats/conversations/${conversationId}/messages`);
    return res.data;
  } catch {
    const fallback = await axiosInstance.get(`/chat/get-messages/${conversationId}`);
    return fallback.data;
  }
};

export const sendMessage = async (payload) => {
  const isFormData = typeof FormData !== "undefined" && payload instanceof FormData;
  // Same reasoning as useChatStore: never set Content-Type for FormData, or the multipart
  // boundary is missing and multer rejects the request.
  const res = await axiosInstance.post("/chat/send-message", payload);
  return res.data;
};

export const markMessagesAsRead = async ({ messageIds, conversationId }) => {
  try {
    const res = await axiosInstance.put("/chats/messages/read", { messageIds, conversationId });
    return res.data;
  } catch {
    if (messageIds && messageIds[0]) {
      const fallback = await axiosInstance.put("/chat/mark-as-read", { messageId: messageIds[0] });
      return fallback.data;
    }
  }
};

export const markAsRead = async (messageId) => {
  const res = await axiosInstance.put("/chat/mark-as-read", { messageId });
  return res.data;
};

export const deleteMessage = async (messageId) => {
  try {
    const res = await axiosInstance.delete(`/chats/messages/${messageId}`);
    return res.data;
  } catch {
    const fallback = await axiosInstance.delete(`/chat/delete-message/${messageId}`);
    return fallback.data;
  }
};

export const deleteConversation = async (conversationId) => {
  const res = await axiosInstance.delete(`/chat/delete-conversation/${conversationId}`);
  return res.data;
};

// Forward an existing message to another user. The server checks the source message really
// belongs to a conversation you are part of, so this cannot be used to read other people's chats.
export const forwardMessage = async ({ messageId, receiverId }) => {
  const res = await axiosInstance.post("/chat/forward", { messageId, receiverId });
  return res.data;
};

// Substring search across the caller's own messages. Returns { count, messages }.
export const searchMessages = async (query) => {
  const res = await axiosInstance.get("/chat/search", { params: { q: query } });
  return res.data;
};
