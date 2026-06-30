import { NextResponse } from "next/server";
import { verifyAppCredentials } from "@/lib/appUsers";

type LoginRequestBody = {
  username?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginRequestBody;
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username.trim() || !password) {
      return NextResponse.json(
        { error: "Username and password are required." },
        { status: 400 },
      );
    }

    if (!verifyAppCredentials(username, password)) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unknown authentication error.";

    console.error("[api/auth/login]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
