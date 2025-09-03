import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import Index from "./pages/index";
import Transcribe from "./pages/transcribe";

export function render(url) {
  // Simple server-side routing
  let Page;
  if (url === "/transcribe") {
    Page = Transcribe;
  } else {
    Page = Index;
  }

  const html = renderToString(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
  return { html };
}
