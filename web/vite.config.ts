import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// dev 时 /ws 代理到本机 server（node server/main.ts）；host:true 让手机连 dev server 调试
export default defineConfig({
	plugins: [react()],
	server: {
		host: true,
		proxy: {
			"/ws": { target: "http://localhost:7620", ws: true },
			"/healthz": { target: "http://localhost:7620" },
		},
	},
});
