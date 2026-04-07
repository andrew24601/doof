import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "url";
import path from "path";
import { runPlaygroundSource } from "../src/playground-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createPlaygroundRunPlugin(): Plugin {
  const attachMiddleware = (
    use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void,
  ) => {
    use((req, res, next) => {
      void handlePlaygroundRunRequest(req, res, next);
    });
  };

  return {
    name: "doof-playground-run-endpoint",
    configureServer(server) {
      attachMiddleware((handler) => server.middlewares.use(handler));
    },
    configurePreviewServer(server) {
      attachMiddleware((handler) => server.middlewares.use(handler));
    },
  };
}

async function handlePlaygroundRunRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  if (requestUrl.pathname !== "/api/run") {
    next();
    return;
  }

  if (req.method !== "POST") {
    respondJson(res, 405, { error: "Use POST /api/run." });
    return;
  }

  try {
    const requestBody = await readJsonBody(req);
    if (typeof requestBody.source !== "string") {
      respondJson(res, 400, { error: 'Expected a JSON body with a string "source" field.' });
      return;
    }

    const result = runPlaygroundSource(requestBody.source);
    respondJson(res, 200, result);
  } catch (error) {
    respondJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
      if (totalBytes > 1024 * 1024) {
        reject(new Error("Request body is too large."));
      }
    });

    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) as Record<string, unknown> : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function respondJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default defineConfig({
  plugins: [createPlaygroundRunPlugin()],
  resolve: {
    alias: {
      // Allow importing from the main doof src/ directory
      "@doof": path.resolve(__dirname, "../src"),
      // Polyfill node:path for browser (used by resolver.ts)
      "node:path": path.resolve(
        __dirname,
        "node_modules/path-browserify",
      ),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
