import "./theme.css";
import "./style.css";
import { renderAdminApp } from "./components/AdminApp.ts";
import { renderAuthApp } from "./components/AuthApp.ts";
import { renderPaymentResult } from "./components/PaymentResult.ts";
import { renderRetailerApp } from "./components/RetailerApp.ts";
import { renderSupplierApp } from "./components/SupplierApp.ts";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("The application root could not be found.");
}
const params = new URLSearchParams(window.location.search);
const hasPaymentOutcome =
  window.location.pathname === "/" &&
  (Boolean(params.get("status")) || Boolean(sessionStorage.getItem("soukcart:payment-return")));

if (hasPaymentOutcome) {
  renderPaymentResult(app);
} else if (window.location.pathname.startsWith("/admin")) {
  renderAdminApp(app);
} else if (window.location.pathname.startsWith("/retailer")) {
  renderRetailerApp(app);
} else if (window.location.pathname.startsWith("/supplier")) {
  renderSupplierApp(app);
} else {
  renderAuthApp(app);
}
