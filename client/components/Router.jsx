import { useState, useEffect } from "react";
import Index from "../pages/index";
import Transcribe from "../pages/transcribe";

export default function Router() {
  const [currentPath, setCurrentPath] = useState(
    typeof window !== "undefined" ? window.location.pathname : "/"
  );

  useEffect(() => {
    // Handle browser navigation
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener("popstate", handlePopState);
    
    // Handle link clicks for client-side navigation
    const handleClick = (e) => {
      if (e.target.tagName === "A" && e.target.href.startsWith(window.location.origin)) {
        e.preventDefault();
        const path = e.target.getAttribute("href");
        window.history.pushState(null, "", path);
        setCurrentPath(path);
      }
    };

    document.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("click", handleClick);
    };
  }, []);

  // Simple routing logic
  switch (currentPath) {
    case "/transcribe":
      return <Transcribe />;
    case "/":
    default:
      return <Index />;
  }
}
