import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// One-time cleanup: clear corrupted tab data from previous versions
const CLEANUP_KEY = 'ppterminals_cleanup_v1';
if (!localStorage.getItem(CLEANUP_KEY)) {
  localStorage.removeItem('ppterminals_tabs');
  localStorage.setItem(CLEANUP_KEY, '1');
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
