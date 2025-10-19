import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import dotenv from "dotenv";
import httpProxy from "http-proxy";
import dns from "node:dns/promises";
import net from "node:net";
import { ProxyAgent } from "proxy-agent";

dotenv.config();

type HttpsConfig = {
  key?: string;
  cert?: string;
  ca?: string;
};

const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8080", 10);
const HTTPS_PORT = process.env.HTTPS_PORT
  ? parseInt(process.env.HTTPS_PORT, 10)
  : undefined;

// 可选HTTPS证书配置
const httpsConfig: HttpsConfig = {
  key: process.env.HTTPS_KEY_PATH,
  cert: process.env.HTTPS_CERT_PATH,
  ca: process.env.HTTPS_CA_PATH,
};

// 支持的前缀说明：
// - https://hots.com/https://api.openai.com/v1/chat -> 直连 https://api.openai.com/v1/chat
// - wss://hots.com/xxx -> 直连 wss://xxx

const STRICT_SSL = process.env.PROXY_REJECT_UNAUTHORIZED !== "false"; // 默认严格校验证书
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  secure: STRICT_SSL,
});

// 上游代理（支持 http_proxy/https_proxy/no_proxy），仅当环境变量存在时启用
const upstreamProxyAgent: any = (() => {
  const hasProxy =
    process.env.http_proxy ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.HTTPS_PROXY;
  if (!hasProxy) return undefined;
  try {
    return new ProxyAgent();
  } catch {
    return undefined;
  }
})();

proxy.on("error", (err, req, res) => {
  // res 可能是 ServerResponse 或 Socket（WS 场景），需先做类型收窄
  if ("writeHead" in res && typeof (res as any).writeHead === "function") {
    const serverRes = res as http.ServerResponse;
    if (!serverRes.headersSent) {
      serverRes.writeHead(502, { "Content-Type": "application/json" });
    }
    serverRes.end(
      JSON.stringify({ error: "Bad gateway", message: err.message })
    );
  } else {
    const socket = res as import("node:net").Socket;
    try {
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    } finally {
      socket.destroy();
    }
  }
});

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
];

proxy.on("proxyReq", (proxyReq) => {
  for (const h of HOP_BY_HOP_HEADERS) {
    try {
      proxyReq.removeHeader(h);
    } catch {}
  }
});

function resolveTargetFromRequest(req: http.IncomingMessage): string | null {
  // 1) 允许完整URL直通：当path以 http:// 或 https:// 或 ws:// 或 wss:// 开头时
  const host = req.headers.host || "";
  const url = new URL(req.url || "/", `http://${host}`);
  // 保留原始编码，避免对中文等字符过早解码造成 "unescaped characters"
  const rawPath = url.pathname + (url.search || "");

  // 去掉开头的斜杠
  const trimmed = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;

  if (/^(https?:\/\/|wss?:\/\/)/i.test(trimmed)) {
    return trimmed;
  }

  // 2) 兼容 hots.com/https://api.openai.com/v1/chat 这种形式
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }

  // 3) 兼容 wss/ws 前缀：wss://hots.com/xxx -> wss://xxx
  // 当使用WSS监听时，请求到这时 path 通常为 /xxx，我们需要补成 wss://xxx
  // 但是无法确定原始scheme，这里通过Upgrade头判断：
  const upgradeHeader = (req.headers["upgrade"] || "").toString().toLowerCase();
  if (upgradeHeader === "websocket" && trimmed.length > 0) {
    // 如果来自HTTPS服务器的升级，则多半是wss，否则是ws
    const viaHttps = (req.socket as any).encrypted === true;
    const scheme = viaHttps ? "wss://" : "ws://";
    return scheme + trimmed;
  }

  // 4) 非升级请求：允许形如 hots.com/host/path 的通用透传？此处按需求仅支持完整URL
  return null;
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1") return true; // loopback
  // fc00::/7 unique local, fe80::/10 link-local
  return h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
}

function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home"))
    return true;
  if (
    h.endsWith(".internal") ||
    h.endsWith(".intranet") ||
    h.endsWith(".localdomain")
  )
    return true;

  const ipType = net.isIP(hostname);
  if (ipType === 4) return isPrivateIPv4(hostname);
  if (ipType === 6) return isPrivateIPv6(hostname);
  return false;
}

async function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  // 拒绝 CONNECT 方法
  if (req.method === "CONNECT") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  const target = resolveTargetFromRequest(req);
  if (!target) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Bad request",
        message: "Path must start with full URL, e.g. /https://example.com/api",
      })
    );
    return;
  }
  // 不再限制请求体大小

  // 规范化并编码 target，确保不会因未转义字符报错
  let normalizedTarget: string;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target);
    normalizedTarget = parsedUrl.toString();
  } catch (e: any) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Invalid target URL",
        message: e?.message || String(e),
      })
    );
    return;
  }

  // 禁止使用 IP 或内网域名 + DNS 解析落到内网
  if (isForbiddenHost(parsedUrl.hostname)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Forbidden",
        message: "Target host is not allowed",
      })
    );
    return;
  }
  if (await resolvesToPrivateAddress(parsedUrl.hostname)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Forbidden",
        message: "Target host resolves to private address",
      })
    );
    return;
  }

  try {
    proxy.web(req, res, {
      target: normalizedTarget,
      ignorePath: true,
      agent: upstreamProxyAgent,
    });
  } catch (err: any) {
    if (!res.headersSent) {
      res.writeHead(400, { "Content-Type": "application/json" });
    }
    res.end(
      JSON.stringify({
        error: "Proxy error",
        message: err?.message || String(err),
      })
    );
  }
}

async function handleWsUpgrade(
  req: http.IncomingMessage,
  socket: any,
  head: Buffer
) {
  const target = resolveTargetFromRequest(req);
  if (!target) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  // 规范化并编码 target
  let normalizedTarget: string;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target);
    normalizedTarget = parsedUrl.toString();
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  // 禁止使用 IP 或内网域名（WS）
  if (isForbiddenHost(parsedUrl.hostname)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  if (await resolvesToPrivateAddress(parsedUrl.hostname)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  try {
    proxy.ws(req, socket, head, {
      target: normalizedTarget,
      ignorePath: true,
      agent: upstreamProxyAgent,
    });
  } catch {
    try {
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    } finally {
      socket.destroy();
    }
  }
}

function createHttpServers() {
  const httpServer = http.createServer(handleHttpRequest);
  httpServer.on("upgrade", handleWsUpgrade);
  httpServer.listen(HTTP_PORT, () => {
    console.log(`[proxy] HTTP listening on :${HTTP_PORT}`);
  });
  // 不设置 request/headers/socket 超时

  if (HTTPS_PORT) {
    if (!httpsConfig.key || !httpsConfig.cert) {
      console.warn(
        "[proxy] HTTPS_PORT provided but HTTPS_KEY_PATH/HTTPS_CERT_PATH missing, skip HTTPS server"
      );
    } else {
      const options: https.ServerOptions = {
        key: fs.readFileSync(httpsConfig.key),
        cert: fs.readFileSync(httpsConfig.cert),
        ca: httpsConfig.ca ? fs.readFileSync(httpsConfig.ca) : undefined,
      };
      const httpsServer = https.createServer(options, handleHttpRequest);
      httpsServer.on("upgrade", handleWsUpgrade);
      httpsServer.listen(HTTPS_PORT, () => {
        console.log(`[proxy] HTTPS listening on :${HTTPS_PORT}`);
      });
      // 不设置 request/headers/socket 超时
    }
  }
}

createHttpServers();

async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  const ipType = net.isIP(hostname);
  if (ipType === 4) return isPrivateIPv4(hostname);
  if (ipType === 6) return isPrivateIPv6(hostname);
  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const r of records) {
      if (r.family === 4 && isPrivateIPv4(r.address)) return true;
      if (r.family === 6 && isPrivateIPv6(r.address)) return true;
    }
  } catch {
    // 忽略DNS错误，由下游连接去决定
  }
  return false;
}
