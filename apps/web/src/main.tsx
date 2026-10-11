import { LucideProvider } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <LucideProvider strokeWidth={1.5}>
      <App />
    </LucideProvider>
  </StrictMode>,
);
