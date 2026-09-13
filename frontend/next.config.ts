import path from 'node:path'
import type { NextConfig } from 'next'

// shared/ lives above the app directory, so file tracing has to start at the repo
// root or Next infers a workspace root that excludes the shared contract.
const nextConfig: NextConfig = {
	outputFileTracingRoot: path.join(process.cwd(), '..'),
}

export default nextConfig
