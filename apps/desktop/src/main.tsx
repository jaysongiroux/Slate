import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { DatabaseProvider } from "./db/DatabaseProvider";
import { TooltipProvider } from "./components/ui/tooltip";
import "highlight.js/styles/github-dark-dimmed.min.css";
import "./styles/tailwind.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <DatabaseProvider>
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <App />
    </TooltipProvider>
  </DatabaseProvider>,
);
