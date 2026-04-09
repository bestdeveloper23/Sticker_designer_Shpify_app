import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
} from "react-router";

/**
 * Polaris web components (<s-page>, etc.) only render after polaris.js runs.
 * See https://shopify.dev/docs/api/app-home/polaris-web-components
 */
export async function loader() {
  return {
    shopifyApiKey: process.env.SHOPIFY_API_KEY ?? "",
  };
}

export default function App() {
  const { shopifyApiKey } = useLoaderData();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="shopify-api-key" content={shopifyApiKey} />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message =
    error?.message || (typeof error === "string" ? error : "Something went wrong");

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <title>Custom Sticker Designer – Error</title>
      </head>
      <body
        style={{
          fontFamily: "Inter, sans-serif",
          padding: "2rem",
          maxWidth: "600px",
          margin: "0 auto",
        }}
      >
        <h1>Application error</h1>
        <p>{message}</p>
        <p style={{ color: "#6d7175", fontSize: "0.9rem" }}>
          If you just installed the app, ensure these environment variables are
          set in Vercel: <code>DATABASE_URL</code>, <code>SHOPIFY_API_KEY</code>,{" "}
          <code>SHOPIFY_API_SECRET</code>, and <code>SHOPIFY_APP_URL</code>.
        </p>
        <Scripts />
      </body>
    </html>
  );
}
