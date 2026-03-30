import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import "prismjs/themes/prism-okaidia.css";
import "./styles/tailwind.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <TooltipProvider delayDuration={400} skipDelayDuration={200}>
    <App />
  </TooltipProvider>,
);
