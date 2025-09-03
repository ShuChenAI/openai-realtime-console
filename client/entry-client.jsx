import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import Router from "./components/Router";
import "./base.css";

ReactDOM.hydrateRoot(
  document.getElementById("root"),
  <StrictMode>
    <Router />
  </StrictMode>,
);
