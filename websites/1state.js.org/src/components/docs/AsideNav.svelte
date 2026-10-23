<script>
import LayoutAsideNav from "@willfarrell-ds/svelte/components/LayoutAsideNav.svelte";

const nav = {
	"Getting Started": {
		Introduction: "/docs",
		"Quick Start": "/docs/quick-start",
	},
	Concepts: {
		"Derived position": "/docs/concepts/derived-position",
		Composition: "/docs/concepts/composition",
		URLs: "/docs/concepts/urls",
		Persistence: "/docs/concepts/persistence",
		Limits: "/docs/concepts/limits",
	},
	Reference: {
		Definition: "/docs/reference/definition",
		API: "/docs/reference/api",
	},
	Packages: {
		core: "/docs/packages/core",
		validate: "/docs/packages/validate",
		mermaid: "/docs/packages/mermaid",
	},
	Examples: {
		"Onboarding wizard": "/docs/examples/onboarding",
	},
};
</script>

<LayoutAsideNav {nav} />
