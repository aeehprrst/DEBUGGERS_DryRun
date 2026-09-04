import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { id: "usr_local" },
    update: {},
    create: { id: "usr_local", email: "local@dryrun.dev" },
  });

  await prisma.project.upsert({
    where: { id: "proj_meridian" },
    update: {},
    create: {
      id: "proj_meridian",
      targetUrl: "http://localhost:5173",
      userId: "usr_local",
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
