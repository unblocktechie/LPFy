import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const mark = path.join(root, "src/assets/lpfi-mark.png");
const wordmark = path.join(root, "src/assets/lpfi-wordmark.png");

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@lpfi-mark": mark,
			"@lpfi-wordmark": wordmark,
		},
	},
	server: {
		port: 5173,
		host: true,
	},
});
