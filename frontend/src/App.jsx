import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Route, Routes, Navigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import Login from "./pages/user-login/Login";
import HomePage from "./components/HomePage";
import { ProtectedRoute, PublicRoute } from "./Protected";
import "./App.css";

import useUserStore from "./store/useUserStore";
import useChatStore from "./store/useChatStore";
import { initializeSocket, disconnectSocket, getSocket } from "./services/chat.service";
import { ensureCallInit } from "./services/trtc.service";
import { notifyAppReady } from "./services/updater.service";

function App() {
  const { user } = useUserStore();
  const { setCurrentUser, fetchConversations, cleanUp } = useChatStore();

  // TUICallKit's overlay component, resolved once the SDK is initialised.
  const [CallKit, setCallKit] = useState(null);

  useEffect(() => {
    if (!user?._id) {
      cleanUp();
      disconnectSocket();
      return;
    }

    setCurrentUser(user);
    initializeSocket();
    fetchConversations();

    const socket = getSocket();
    if (socket) {
      socket.on("userUpdated", () => {
        fetchConversations();
      });
    }

    return () => {
      const s = getSocket();
      if (s) {
        s.off("userUpdated");
      }
    };
  }, [user?._id]);

  // Register with TRTC as soon as we know who the user is — NOT when they place a call.
  //
  // Until TUICallKitAPI.init() runs, this client is not registered with TRTC and therefore cannot
  // RECEIVE an incoming call. Placing a call used to work on its own (ChatWindow initialised the
  // SDK on demand), but being called never did.
  //
  // Missing/disabled calling is not an error worth surfacing — it is the normal state until TRTC
  // credentials are configured — so this fails quietly.
  useEffect(() => {
    if (!user?._id) return;

    let cancelled = false;

    ensureCallInit()
      .then((trtc) => {
        if (!cancelled) setCallKit(() => trtc.TUICallKit);
      })
      .catch((err) => {
        console.warn("Call setup skipped:", err?.message || err);
      });

    return () => {
      cancelled = true;
    };
  }, [user?._id]);

  // The app must confirm a successful launch to the OTA updater, or the bundle is rolled back.
  // Mounted here rather than in index.jsx so it runs once the app tree exists.
  useEffect(() => {
    notifyAppReady();
  }, []);

  return (
    <>
      <ToastContainer position="top-right" autoClose={3000} theme="colored" />

      {/* Mounted at the app root so an incoming call can appear over ANY screen, not just an open
          chat. ChatWindow used to be the only host, which meant a call arriving while browsing
          status or settings would never be shown. */}
      {CallKit && <CallKit />}

      <Router>
        <Routes>
          <Route element={<PublicRoute />}>
            <Route path="/user-login" element={<Login />} />
            <Route path="/login" element={<Navigate to="/user-login" replace />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/status" element={<HomePage />} />
            <Route path="/settings" element={<HomePage />} />
            <Route path="/user-profile" element={<HomePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </>
  );
}

export default App;
