"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";

const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";

// ============================================
// TYPES
// ============================================
export type Session = {
  sub: string | number;
  username: string;
  name: string | null;
  email: string | null;
};

export type UserWithMemberships = {
  id: number;
  username: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  memberships: {
    groupId: number;
    groupSlug: string;
    groupName: string;
    roleId: number;
    roleName: string;
  }[];
};

// ============================================
// SESSION MANAGEMENT
// ============================================
export async function readSession(): Promise<Session | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;
    if (!token) return null;

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return {
      sub: decoded.userId,
      username: decoded.username,
      name: decoded.name || null,
      email: decoded.email || null,
    };
  } catch {
    return null;
  }
}

// ============================================
// LOGIN
// ============================================
export async function login(prevState: any, formData: FormData) {
  try {
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    if (!username || !password) {
      return { error: "Username dan password harus diisi" };
    }

    // Cari user di database
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return { error: "Username atau password salah" };
    }

    if (!user.isActive) {
      return { error: "Akun tidak aktif. Hubungi administrator." };
    }

    // Verifikasi password
    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      return { error: "Username atau password salah" };
    }

    // Buat JWT token (tanpa role, karena role per-group)
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Set cookie
    const cookieStore = await cookies();
    cookieStore.set("auth-token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 hari
    });
  } catch (error) {
    console.error("Login error:", error);
    return { error: "Terjadi kesalahan saat login" };
  }

  redirect("/admin");
}

// ============================================
// LOGOUT
// ============================================
export async function logout() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete("auth-token");
  } catch (error) {
    console.error("Logout error:", error);
  }

  redirect("/login");
}

// ============================================
// GET USER (Simple)
// ============================================
export async function getUser() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;

    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
      username: string;
      name?: string;
      email?: string;
    };

    // Cari user di database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (!user || !user.isActive) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  } catch (error) {
    console.error("Get user error:", error);
    return null;
  }
}

// ============================================
// GET USER WITH MEMBERSHIPS
// ============================================
export async function getUserWithMemberships(): Promise<UserWithMemberships | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;

    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
    };

    // Cari user dengan memberships
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        memberships: {
          select: {
            group: {
              select: {
                id: true,
                slug: true,
                name: true,
              },
            },
            role: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      memberships: user.memberships.map((m) => ({
        groupId: m.group.id,
        groupSlug: m.group.slug,
        groupName: m.group.name,
        roleId: m.role.id,
        roleName: m.role.name,
      })),
    };
  } catch (error) {
    console.error("Get user with memberships error:", error);
    return null;
  }
}

// ============================================
// GET USER ID (for internal use)
// ============================================
export async function getUserId(): Promise<number | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;

    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
    };

    return decoded.userId;
  } catch {
    return null;
  }
}

// ============================================
// REQUIRE AUTH (throws if not logged in)
// ============================================
export async function requireAuth() {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
