# host-forward

一个基于 Node.js + TypeScript 的通用协议转发服务，支持 HTTP/HTTPS 与 WS/WSS。

## 特性
- 支持转发所有方法与头（GET/POST/PUT/DELETE 等）
- 支持流式响应与 WebSocket 升级
- 通过路径携带完整目标 URL 进行转发
  - `https://hots.com/https://api.openai.com/v1/chat` -> 转发到 `https://api.openai.com/v1/chat`
  - `wss://hots.com/echo.websocket.events` -> 转发到 `wss://echo.websocket.events`
- 可选开启 HTTPS 监听（通过环境变量加载证书）

## 快速开始
```bash
npm i
npm run dev
# 或
pnpm i
pnpm dev
```

默认监听 `HTTP_PORT=8080`。访问示例：
```bash
curl -i "http://localhost:8080/https://api.openai.com/v1/chat" \
  -H "Authorization: Bearer sk-***" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

WebSocket 示例（以 echo 服务为例）：
```bash
npx wscat -c ws://localhost:8080/wss://echo.websocket.events
```

## 环境变量
- `HTTP_PORT`：HTTP 监听端口，默认 8080
- `HTTPS_PORT`：启用则额外监听 HTTPS 端口
- `HTTPS_KEY_PATH`/`HTTPS_CERT_PATH`/`HTTPS_CA_PATH`：HTTPS 证书文件路径
- `PROXY_REJECT_UNAUTHORIZED`：是否严格校验证书（默认 false，目标为自签名证书时可置为 false）

> 提示：`.env` 文件示例可参考上述变量名，放在项目根目录即可被加载。

## 注意
- 仅当路径以完整的 `http://`/`https://`/`ws://`/`wss://` URL 开头时进行转发；否则返回 400。
- 若在公网域名（如 `hots.com`）后跟完整 URL，即可实现：
  - `https://hots.com/https://api.openai.com/v1/chat` -> 直达 OpenAI Chat API
  - `wss://hots.com/xxx` -> 直连 `wss://xxx`

## 构建与运行
```bash
npm run build
npm start
```

## 许可
MIT
