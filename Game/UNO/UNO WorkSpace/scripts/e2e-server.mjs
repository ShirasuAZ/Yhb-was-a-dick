import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const root = process.cwd();
const unoPort = 3100;
const shogiPort = 3101;
const proxyPort = 3199;
const environment = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: String(unoPort),
  SHOGI_HOST: "127.0.0.1",
  SHOGI_PORT: String(shogiPort),
  UNO_DATA_DIR: `${root}/test-results/e2e-data`
};

const children = [
  spawn(process.execPath, ["dist/server/index.js"], { cwd: root, env: environment, stdio: "inherit" }),
  spawn(process.execPath, ["dist/server/shogi-index.js"], { cwd: root, env: environment, stdio: "inherit" })
];

function upstreamPort(requestUrl = "") {
  return requestUrl.startsWith("/shogi") || requestUrl.startsWith("/api/shogi/")
    ? shogiPort
    : unoPort;
}

const proxy = http.createServer((request, response) => {
  const port = upstreamPort(request.url);
  const upstream = http.request({
    host: "127.0.0.1",
    port,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: `127.0.0.1:${port}` }
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});

proxy.on("upgrade", (request, clientSocket, head) => {
  const port = upstreamPort(request.url);
  const upstreamSocket = net.connect(port, "127.0.0.1", () => {
    const headers = [...request.rawHeaders];
    for (let index = 0; index < headers.length; index += 2) {
      if (headers[index]?.toLowerCase() === "host") headers[index + 1] = `127.0.0.1:${port}`;
    }
    upstreamSocket.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.reduce((lines, value, index) => index % 2 === 0 ? `${lines}${value}: ` : `${lines}${value}\r\n`, "")}\r\n`);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });
  upstreamSocket.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstreamSocket.destroy());
});

proxy.listen(proxyPort, "127.0.0.1");

function shutdown() {
  proxy.close();
  for (const child of children) child.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
for (const child of children) child.on("exit", (code) => {
  if (code && code !== 0) process.exitCode = code;
  shutdown();
});
