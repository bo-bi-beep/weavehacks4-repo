import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@copilotkit/react-core"],
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
