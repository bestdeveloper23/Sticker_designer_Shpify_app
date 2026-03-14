import { PassThrough } from "node:stream";
import React from "react";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { addDocumentResponseHeaders } from "./shopify.server";

const STREAM_TIMEOUT = 5_000;

/** Default Node handler when @vercel/react-router is not available (e.g. shopify app dev). */
function defaultNodeHandleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  routerContext,
  loadContext,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return Promise.resolve(
      new Response(null, { status: responseStatusCode, headers: responseHeaders }),
    );
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");
    const readyOption =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";

    const { pipe, abort } = renderToPipeableStream(
      React.createElement(ServerRouter, {
        context: routerContext,
        url: request.url,
      }),
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          pipe(body);
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          if (shellRendered) console.error(error);
        },
      },
    );

    const timeoutId = setTimeout(() => abort(), STREAM_TIMEOUT + 1000);
  });
}

let handleRequestImpl;

try {
  const mod = await import("@vercel/react-router/entry.server");
  handleRequestImpl = mod.default ?? mod.handleRequest;
} catch {
  handleRequestImpl = defaultNodeHandleRequest;
}

/**
 * Entry server: add Shopify app headers then delegate to platform handler.
 * Uses @vercel/react-router on Vercel; falls back to Node handler for local dev.
 */
export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
  loadContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  return handleRequestImpl(
    request,
    responseStatusCode,
    responseHeaders,
    reactRouterContext,
    loadContext,
  );
}
