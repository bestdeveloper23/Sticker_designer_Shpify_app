import { handleRequest as vercelHandleRequest } from "@vercel/react-router/entry.server";
import { addDocumentResponseHeaders } from "./shopify.server";

/**
 * Entry server: add Shopify app headers then delegate to Vercel's handler.
 * This works with the Vercel React Router preset so the app builds and runs on Vercel.
 */
export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
  loadContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    reactRouterContext,
    loadContext,
  );
}
