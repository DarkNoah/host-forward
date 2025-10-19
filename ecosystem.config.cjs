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
        // 可选：上游代理，用于该进程的所有出站请求
        // http_proxy: "http://127.0.0.1:7890",
        // https_proxy: "http://127.0.0.1:7890",
        // no_proxy: "localhost,127.0.0.1",
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
        // 可选：上游代理（开发环境）
        // http_proxy: "http://127.0.0.1:7890",
        // https_proxy: "http://127.0.0.1:7890",
        // no_proxy: "localhost,127.0.0.1",
      },
    },
  ],
};
