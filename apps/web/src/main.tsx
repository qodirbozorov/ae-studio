import { LucideProvider } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./admin/AdminApp";
import { App } from "./App";
import { setupPwa } from "./pwa";
import "./styles.css";

setupPwa();

// `/admin` — alohida ilova (o'z kirishi, foydalanuvchi sessiyasiga bog'liq emas).
const isAdmin =
  window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <LucideProvider strokeWidth={1.5}>{isAdmin ? <AdminApp /> : <App />}</LucideProvider>
  </StrictMode>,
);
