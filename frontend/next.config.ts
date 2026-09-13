import path from 'node:path'
import type { NextConfig } from 'next'

// shared/ lives above the app directory, so file tracing has to start at the repo
// root or Next infers a workspace root that excludes the shared contract.
const nextConfig: NextConfig = {
	outputFileTracingRoot: path.join(process.cwd(), '..'),
	// Concurrent dev servers on different ports would otherwise share one build
	// directory and overwrite each other's manifests.
	distDir: process.env.NEXT_DIST_DIR ?? '.next',
	// The floating dev badge sits over the bottom-left of every page and lands in
	// screenshots. Nothing depends on it.
	devIndicators: false,
}

export default nextConfig
