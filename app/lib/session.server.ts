import { createCookieSessionStorage } from "@remix-run/node";
import { SESSION_SECRET } from "./config";

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "_auth",
    sameSite: "strict",
    path: "/",
    httpOnly: true,
    secrets: [SESSION_SECRET],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
});

export async function getSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  return sessionStorage.getSession(cookie);
}

export async function commitSession(session: any, cookieOptions?: any) {
  return sessionStorage.commitSession(session, cookieOptions);
}

export async function destroySession(session: any) {
  return sessionStorage.destroySession(session);
} 