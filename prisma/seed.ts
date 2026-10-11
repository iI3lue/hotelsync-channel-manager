import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const providerKey = process.env.CHANNEL_MANAGER_SIMULATOR_KEY;
  if (!providerKey || providerKey.length < 32) {
    throw new Error("CHANNEL_MANAGER_SIMULATOR_KEY must be set (min 32 chars)");
  }

  const providerKeyHash = createHash("sha256").update(providerKey).digest("hex");
  await prisma.channel.upsert({
    where: { slug: "simulado" },
    update: { name: "Proveedor simulado", provider_key_hash: providerKeyHash, is_active: true },
    create: {
      slug: "simulado",
      name: "Proveedor simulado",
      provider_key_hash: providerKeyHash,
      is_active: true,
    },
  });

  console.log("Channel Manager simulator channel ensured.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
