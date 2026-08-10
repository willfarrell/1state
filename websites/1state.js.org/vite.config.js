import { globSync, mkdirSync } from "node:fs";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";
import sitemap from "vite-plugin-sitemap";
import sriPrerendered from "vite-plugin-sri";

// The client output, not the adapter's: a file written straight into
// .svelte-kit/cloudflare/ lands after adapter-cloudflare has written
// _routes.json, so the worker owns the path and answers 404. Written here it is
// a client asset, gets copied across, and gets an exclude rule.
const sitemapOutDir = ".svelte-kit/output/client/";
mkdirSync(sitemapOutDir, { recursive: true });

// Only /404 is prerendered, so the plugin has no html to crawl. Name the pages
// off the filesystem instead: every +page except /search, which needs a query.
const routes = globSync("src/routes/**/+page.{md,svelte}")
	.map((file) =>
		file.replace(/^src\/routes/, "").replace(/\/\+page\.(md|svelte)$/, ""),
	)
	.map((route) => route || "/")
	.filter((route) => route !== "/search")
	.sort();

export default defineConfig({
	plugins: [
		// Ahead of sveltekit() so its writeBundle lands before the adapter copies
		// the client output and writes _routes.json.
		sitemap({
			hostname: "https://1state.js.org",
			outDir: sitemapOutDir,
			dynamicRoutes: routes,
			exclude: ["/404"],
		}),
		sveltekit(),
		mkcert({ mkcertPath: "/opt/homebrew/bin/mkcert" }),
		sriPrerendered(),
	],
	build: {
		assetsInlineLimit: 0,
	},
	ssr: {
		noExternal: ["prismjs"],
	},
	optimizeDeps: {
		exclude: ["@willfarrell-ds/svelte", "@willfarrell-ds/vanilla"],
	},
});
