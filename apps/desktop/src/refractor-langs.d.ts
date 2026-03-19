declare module "refractor/*" {
  import type { Syntax } from "refractor/lib/core.js";
  const language: Syntax;
  export default language;
}
