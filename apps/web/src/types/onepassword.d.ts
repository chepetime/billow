/**
 * The Save in 1Password package registers a custom element but declares it on
 * the old global `JSX` namespace, which React 19 no longer reads — it resolves
 * intrinsic elements through `React.JSX`. Without this the element is a type
 * error at every use site.
 */
import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "onepassword-save-button": {
        "data-onepassword-type": "api-key" | "credit-card" | "login";
        value: string;
        "data-theme"?: "light" | "dark";
        padding?: "normal" | "compact" | "none";
        class?: "black" | "white";
        lang?: string;
      };
    }
  }
}
