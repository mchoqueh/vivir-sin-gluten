import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  await prisma.favorite.deleteMany();
  await prisma.itemChange.deleteMany();
  await prisma.itemSnapshot.deleteMany();
  await prisma.officialItem.deleteMany();
  await prisma.sourceSync.deleteMany();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Data reset complete.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
