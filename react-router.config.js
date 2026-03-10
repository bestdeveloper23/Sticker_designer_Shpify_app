import { vercelPreset } from "@vercel/react-router/vite";

/** @type {import('@react-router/dev/config').Config} */
export default {
  ssr: true,
  // ESM (default): Vercel runs the server as ES module; CJS would cause "exports is not defined in ES module scope".
  presets: [vercelPreset()],
};
