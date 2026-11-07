import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "@/components/dashboard/dashboard";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTheme } from "@/lib/theme";

// the Tailwind `dark` variant keys off the class this sets on <html>
initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Dashboard />
    </TooltipProvider>
    <Toaster />
  </StrictMode>,
);
