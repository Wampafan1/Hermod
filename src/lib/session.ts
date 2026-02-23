import { cache } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

const getSessionCached = cache(() => getServerSession(authOptions));

export async function requireAuth() {
  const session = await getSessionCached();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session;
}

export async function getSession() {
  return await getSessionCached();
}
