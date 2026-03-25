import http from "node:http";

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : null);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export async function startMockQiniuServer(routeHandler) {
  const recorded = [];
  let port = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const body = req.method === "POST" ? await readJsonBody(req) : null;
    recorded.push({ method: req.method, path: url.pathname, body });
    const handled = await routeHandler({ req, res, url, body, recorded, port });
    if (!handled) {
      res.statusCode = 404;
      res.end("not found");
    }
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve();
    });
  });

  return {
    port,
    recorded,
    createClientOptions() {
      return {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "test-key",
      };
    },
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
