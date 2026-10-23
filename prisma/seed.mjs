import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_PERMISSIONS = [
  { name: "View CCTV", slug: "view_cctv", category: "cctv", description: "Melihat CCTV yang tersedia" },
  { name: "Manage CCTV", slug: "manage_cctv", category: "cctv", description: "Menambah, edit, hapus CCTV" },
  { name: "View Private CCTV", slug: "view_private_cctv", category: "cctv", description: "Melihat CCTV private dalam grup" },
  { name: "Stream CCTV", slug: "stream_cctv", category: "cctv", description: "Memutar live stream CCTV" },
  { name: "View Users", slug: "view_user", category: "user", description: "Melihat daftar user dalam grup" },
  { name: "Manage Users", slug: "manage_user", category: "user", description: "Mengelola user dalam grup" },
  { name: "Invite Users", slug: "invite_user", category: "user", description: "Mengundang user baru ke grup" },
  { name: "View Roles", slug: "view_role", category: "role", description: "Melihat daftar role dalam grup" },
  { name: "Manage Roles", slug: "manage_role", category: "role", description: "Mengelola role dalam grup" },
  { name: "View Group", slug: "view_group", category: "group", description: "Melihat informasi grup" },
  { name: "Manage Group", slug: "manage_group", category: "group", description: "Mengelola pengaturan grup" },
  { name: "Delete Group", slug: "delete_group", category: "group", description: "Menghapus grup" },
];

const ROLE_TEMPLATES = {
  super_admin: {
    name: "Super Admin",
    description: "Akses penuh ke semua fitur",
    isSystem: true,
    permissions: [
      "view_cctv", "manage_cctv", "view_private_cctv", "stream_cctv",
      "view_user", "manage_user", "invite_user",
      "view_role", "manage_role",
      "view_group", "manage_group", "delete_group",
    ],
  },
  admin: {
    name: "Admin",
    description: "Mengelola CCTV dan user dalam grup",
    isSystem: false,
    permissions: [
      "view_cctv", "manage_cctv", "view_private_cctv", "stream_cctv",
      "view_user", "manage_user", "invite_user",
      "view_role",
      "view_group",
    ],
  },
  operator: {
    name: "Operator",
    description: "Mengelola CCTV dalam grup",
    isSystem: false,
    permissions: [
      "view_cctv", "manage_cctv", "view_private_cctv", "stream_cctv",
      "view_user",
      "view_group",
    ],
  },
  viewer: {
    name: "Viewer",
    description: "Hanya melihat CCTV",
    isSystem: false,
    permissions: [
      "view_cctv", "stream_cctv",
      "view_group",
    ],
  },
};

async function main() {
  console.log("Starting seed...");
  for (const permission of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { slug: permission.slug },
      update: permission,
      create: permission,
    });
  }

  const hashedPassword = await bcrypt.hash("admin123", 10);
  const adminUser = await prisma.user.upsert({
    where: { username: "admin" },
    update: { password: hashedPassword },
    create: {
      username: "admin",
      email: "admin@example.com",
      password: hashedPassword,
      name: "System Administrator",
      isActive: true,
    },
  });

  const defaultGroup = await prisma.group.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      name: "Default Organization",
      slug: "default",
      description: "Grup default untuk CCTV yang belum memiliki grup",
      isPublic: true,
    },
  });

  const createdRoles = {};
  for (const [slug, template] of Object.entries(ROLE_TEMPLATES)) {
    const role = await prisma.role.upsert({
      where: { groupId_slug: { groupId: defaultGroup.id, slug } },
      update: {
        name: template.name,
        description: template.description,
        isSystem: template.isSystem,
      },
      create: {
        groupId: defaultGroup.id,
        slug,
        name: template.name,
        description: template.description,
        isSystem: template.isSystem,
      },
    });
    createdRoles[slug] = role.id;

    const permissions = await prisma.permission.findMany({
      where: { slug: { in: template.permissions } },
    });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  await prisma.userGroup.upsert({
    where: { userId_groupId: { userId: adminUser.id, groupId: defaultGroup.id } },
    update: { roleId: createdRoles.super_admin },
    create: {
      userId: adminUser.id,
      groupId: defaultGroup.id,
      roleId: createdRoles.super_admin,
    },
  });

  console.log("Seed completed successfully!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("Seed error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
