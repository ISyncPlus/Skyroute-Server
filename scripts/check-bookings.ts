import { prisma } from "../src/db/client.js";

async function main() {
  const bookings = await prisma.booking.findMany({
    select: {
      pnr: true,
      userId: true,
      contactEmail: true,
      status: true,
      total: true,
      createdAt: true,
      passengers: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log("Recent bookings in database:", JSON.stringify(bookings, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
