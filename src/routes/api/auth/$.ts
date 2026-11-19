import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { handleEmailSignIn } from "@/lib/auth/sign-in-lockout.server";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => {
        if (new URL(request.url).pathname.endsWith("/sign-in/email")) {
          return handleEmailSignIn(request);
        }
        return auth.handler(request);
      },
    },
  },
});
