module.exports = {
  apps: [
    {
      name: "host-forward",
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "host-forward:dev",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "watch src/server.ts",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
