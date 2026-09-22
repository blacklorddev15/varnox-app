import { io } from "socket.io-client";
import useUserStore from "../store/useUserStore";

let socket = null;

const getServerUrl = () => {
  const apiUrl =
    import.meta?.env?.VITE_API_URL ||
    import.meta?.env?.REACT_APP_API_URL ||
    process.env?.REACT_APP_API_URL ||
    "http://localhost:5001/api";
  return apiUrl.replace(/\/api\/?$/, "");
};

export const initializeSocket = () => {
  if (socket?.connected) return socket;

  const user = useUserStore.getState().user;
  const serverUrl = getServerUrl();

  socket = io(serverUrl, {
    withCredentials: true,
    // Vercel's WebSocket support requires the websocket transport outright: Socket.IO
    // defaults to HTTP long-polling, which cannot be upgraded to a WebSocket in that
    // execution model, so listing "polling" first silently degrades and then fails.
    // Polling is kept in development only, where a proxy may not pass upgrades through.
    transports: import.meta.env.PROD ? ["websocket"] : ["websocket", "polling"],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on("connect", () => {
    console.log("Socket connected:", socket.id);
    if (user?._id) {
      socket.emit("userConnected", user._id);
    }
  });

  socket.on("connect_error", (err) => {
    console.error("Socket connection error:", err.message);
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
  });

  return socket;
};

export const getSocket = () => {
  if (!socket) return initializeSocket();
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};