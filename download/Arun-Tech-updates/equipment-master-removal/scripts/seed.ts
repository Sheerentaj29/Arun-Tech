/**
 * Seed script for the Industrial Inspection Report Automation System.
 * Creates demo users, clients, and plants so the app has accounts to log
 * in with and reference data for creating real reports.
 *
 * Run with: bun run /home/z/my-project/scripts/seed.ts
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const db = new PrismaClient();

// Tiny password hash helper (NOT for production — this is a demo only).
function hashPassword(pw: string): string {
  return createHash("sha256").update(pw).digest("hex");
}

async function main() {
  console.log("Seeding demo users, clients, and plants...");

  // -------- USERS --------
  const admin = await db.user.upsert({
    where: { email: "admin@inspections.demo" },
    update: {},
    create: {
      email: "admin@inspections.demo",
      name: "Priya Admin",
      passwordHash: hashPassword("admin123"),
      role: "ADMIN",
    },
  });

  await db.user.upsert({
    where: { email: "inspector@inspections.demo" },
    update: {},
    create: {
      email: "inspector@inspections.demo",
      name: "Rahul Inspector",
      passwordHash: hashPassword("inspector123"),
      role: "INSPECTOR",
    },
  });

  await db.user.upsert({
    where: { email: "approver@inspections.demo" },
    update: {},
    create: {
      email: "approver@inspections.demo",
      name: "Anita Approver",
      passwordHash: hashPassword("approver123"),
      role: "APPROVER",
    },
  });

  // -------- CLIENTS --------
  const client1 = await db.client.upsert({
    where: { name: "AcidChem Industries Pvt Ltd (DEMO)" },
    update: {},
    create: {
      name: "AcidChem Industries Pvt Ltd (DEMO)",
      industry: "Specialty Chemicals",
      contactName: "Anil Mehta",
      contactEmail: "anil.mehta@acidchem.demo",
      contactPhone: "+91 98200 11223",
      address: "Plot 14, Chemical Zone, Vapi, Gujarat 396195",
      notes: "DEMO DATA — fictional client for training only.",
      isDemo: true,
    },
  });

  const client2 = await db.client.upsert({
    where: { name: "Western Petrochem Ltd (DEMO)" },
    update: {},
    create: {
      name: "Western Petrochem Ltd (DEMO)",
      industry: "Petrochemicals",
      contactName: "Sunita Rao",
      contactEmail: "sunita.rao@westernpetro.demo",
      contactPhone: "+91 98765 43210",
      address: "Refinery Road, Mangalore SEZ, Karnataka 575027",
      notes: "DEMO DATA — fictional client for training only.",
      isDemo: true,
    },
  });

  await db.client.upsert({
    where: { name: "Greenfield Water Solutions (DEMO)" },
    update: {},
    create: {
      name: "Greenfield Water Solutions (DEMO)",
      industry: "Water & Wastewater Treatment",
      contactName: "Imran Khan",
      contactEmail: "imran@greenfieldwater.demo",
      contactPhone: "+91 90909 80808",
      address: "Survey 88, Industrial Area, Pune, Maharashtra 411019",
      notes: "DEMO DATA — fictional client for training only.",
      isDemo: true,
    },
  });

  // -------- PLANTS --------
  const existingPlants = await db.plant.count();

  if (existingPlants === 0) {
    await db.plant.create({
      data: {
        clientId: client1.id,
        name: "Vapi Acid Plant (DEMO)",
        location: "Vapi, Gujarat",
        address: "Plot 14, Chemical Zone, Vapi 396195",
        isDemo: true,
      },
    });

    await db.plant.create({
      data: {
        clientId: client1.id,
        name: "Vapi Solvent Unit (DEMO)",
        location: "Vapi, Gujarat",
        address: "Plot 14B, Chemical Zone, Vapi 396195",
        isDemo: true,
      },
    });

    await db.plant.create({
      data: {
        clientId: client2.id,
        name: "Mangalore Refinery Unit 2 (DEMO)",
        location: "Mangalore, Karnataka",
        address: "Refinery Road, Mangalore SEZ 575027",
        isDemo: true,
      },
    });

    await db.plant.create({
      data: {
        clientId: client1.id,
        name: "Pune Effluent Treatment Plant (DEMO)",
        location: "Pune, Maharashtra",
        address: "Survey 88, Industrial Area, Pune 411019",
        isDemo: true,
      },
    });
  }

  console.log("Seed complete.");
  console.log(`  Users: ${await db.user.count()}`);
  console.log(`  Clients: ${await db.client.count()}`);
  console.log(`  Plants: ${await db.plant.count()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
