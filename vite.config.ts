import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { studioApiPlugin } from "./server/api";
export default defineConfig(({ mode }) => {
  const local = loadEnv(mode, process.cwd(), "");
  for (const key of [
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_ENV_FILE",
    "RHUBARB_PATH",
    "FFMPEG_PATH",
    "FFPROBE_PATH",
  ]) {
    if (!process.env[key] && local[key]) process.env[key] = local[key];
  }
  return {
    plugins: [react(), studioApiPlugin()],
    server: { port: Number(process.env.FRAME_PORT || 5178), strictPort: true },
    // The distributable studio excludes machine-local packs; development can still serve them.
    build: {
      sourcemap: true,
      copyPublicDir: false,
      rollupOptions: { output: { manualChunks: { react: ["react", "react-dom", "react-dom/client"] } } },
    },
  };
});
