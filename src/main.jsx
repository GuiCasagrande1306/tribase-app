import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);

// PWA: registra o service worker só em produção (evita cache atrapalhar o dev)
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
