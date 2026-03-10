import { vercelPreset } from "@vercel/react-router/vite";

/** @type {import('@react-router/dev/config').Config} */
export default {
  ssr: true,
  // CJS server build so Vercel's Node runtime loads react-router consistently (avoids ESM "Named export not found").
  serverModuleFormat: "cjs",
  presets: [vercelPreset()],
};
