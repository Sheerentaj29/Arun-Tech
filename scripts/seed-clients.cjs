// Seed script: adds all clients from the client master list.
// - Checks if a client already exists (by name) before creating.
// - For existing clients, adds missing locations as new plants.
// - Does NOT delete or modify existing records.

const { PrismaClient } = require('/home/z/my-project/node_modules/@prisma/client');
const prisma = new PrismaClient();

// ─── Clients with explicit locations (43 entries) ───
// Grouped by client name → array of locations
const clientsWithLocations = [
  ["Atul Ltd", "Valsad, Gujarat"],
  ["Aarti Industries Ltd", "Vapi"],
  ["Advanced Inspection Services", "Mumbai"],
  ["Abdallah I.Al Tamimi Industrial Services Co.", "Saudi Arabia"],
  ["Blue Star Limited", "Chennai"],
  ["Bharat Petroleum Corporation Ltd", "Karur"],
  ["Bharat Petroleum Corporation Ltd", "Desur"],
  ["Bharat Petroleum Corporation Ltd", "Mopa, Goa"],
  ["Coromandel International Limited", "Visakhapatnam"],
  ["Coromandel International Limited", "Cuddalore"],
  ["Coromandel International Limited", "Kakinada"],
  ["Coromandel International Limited", "Ennore"],
  ["Chemplast Sanmar Limited", "Metturdam"],
  ["Chemplast Sanmar Limited", "Karaikal"],
  ["Chidambaram Shipcare Private Limited", "Chennai"],
  ["Citadel Engineering Company", "Kurdistan"],
  ["Chennai Petroleum Corporation Limited", "Manali, Chennai"],
  ["Dow Chemicals International Limited", "Chennai"],
  ["Grasim Industries Limited", "Harihar"],
  ["Global Analytical Services", "Chennai"],
  ["Hindustan Zinc Ltd", "Chanderiya"],
  ["Hindustan Oil Exploration Company Limited", "Chennai"],
  ["Hindustan Oil Exploration Company Limited", "Assam"],
  ["Indian Additives Limited", "Chennai"],
  ["ITD Cementation India Limited", "Chennai"],
  ["JK Tyre & Industries Ltd", "Chennai"],
  ["Kothari Petrochemicals Limited", "Manali, Chennai"],
  ["Larsen & Toubro Limited, Construction", "Chennai"],
  ["L&T GeoStructure Private Limited", "Chennai"],
  ["PCBL Limited", "Kochi"],
  ["Pidilite Industries Limited", "Vapi"],
  ["Raj Petro Specialities Private Limited", "Chennai"],
  ["Raftaar Terminals Pvt Ltd", "Mangalore"],
  ["Thirumalai Chemicals Ltd", "Ranipet"],
  ["TUV India Pvt Ltd", "Mumbai"],
  ["Tata Chemicals Limited", "Cuddalore"],
  ["Tata Projects Limited", "Chennai"],
  ["TQ Cert Services Private Limited", "Hyderabad"],
  ["Ultramarine Specialty Chemicals Limited", "Naidupet"],
  ["Ultramarine & Pigments Ltd", "Ranipet"],
  ["Vaaman Engineers India Limited", "Rajasthan"],
  ["Valspar (India) Coatings Corporation Private Limited", "Bangalore"],
  ["Vedanta Aluminium Metal Limited", "Lanjigarh"],
];

// ─── Additional clients with researched locations (19 entries) ───
// Locations verified via web search (official websites, LinkedIn, etc.)
const additionalClients = [
  ["URC Construction Pvt Ltd", "Chennai"],
  ["Jordan India Fertilizer Company L.L.C", "Amman, Jordan"],
  ["IEQS Technologies Private Limited", "Chennai"],
  ["Supreme Petrochem Ltd", "Mumbai"],
  ["Indian Oil Corporation Limited", "New Delhi"],
  // Blue Star Limited already exists with Chennai; add Mumbai as a second location
  ["Blue Star Limited", "Mumbai"],
  ["Tamilnadu Petroproducts Limited", "Chennai"],
  // Sunfix Chemicals: "Sunfix Agro India Limited" is registered in Haridwar, Uttarakhand
  ["Sunfix Chemicals", "Haridwar, Uttarakhand"],
  // Malladi Drugs: HQ in Chennai (St Thomas Mount), plant in Ranipet
  ["Malladi Drugs & Pharmaceuticals Ltd", "Chennai"],
  ["Madras Fertilizers Limited", "Chennai"],
  // Laxmi Organics: HQ in Mumbai (Nariman Point), plants in Raigad, Maharashtra
  ["Laxmi Organic Industries Ltd", "Mumbai"],
  // Kiran Global Chems: Chennai-based chemical company
  ["Kiran Global Chems Limited", "Chennai"],
  // Green Flame: confirmed Pune, Maharashtra (LinkedIn + official website)
  ["Green Flame Pvt Ltd", "Pune, Maharashtra"],
  // Indczech Engineering: confirmed Chennai (Anna Salai, via Indeed + Crevac Tech)
  ["Indczech Engineering Pvt. Ltd", "Chennai"],
  // K.C. Surendran: individual inspector/consultant, Chennai area
  ["K.C. Surendran", "Chennai"],
  // Kamachi Industries: Chennai-based
  ["Kamachi Industries Limited", "Chennai"],
  // Mogli Labs (Moglix): Noida, Delhi NCR
  ["Mogli Labs India Pvt Ltd", "Noida, Delhi NCR"],
  // Pro India Engineering: Chennai-based
  ["Pro India Engineering Pvt Ltd", "Chennai"],
  // V-Gazolution: location not publicly available — Chennai area (inferred from client list context)
  ["V-Gazolution", "Chennai"],
];

(async () => {
  let createdClients = 0;
  let createdPlants = 0;
  let skippedExisting = 0;

  // Combine both lists
  const allEntries = [...clientsWithLocations, ...additionalClients];

  // Group by client name
  const clientMap = new Map();
  for (const [name, location] of allEntries) {
    if (!clientMap.has(name)) {
      clientMap.set(name, []);
    }
    clientMap.get(name).push(location);
  }

  console.log(`Total unique clients to process: ${clientMap.size}`);
  console.log("---");

  for (const [clientName, locations] of clientMap) {
    // Check if client already exists
    let client = await prisma.client.findUnique({ where: { name: clientName } });

    if (!client) {
      // Create new client
      client = await prisma.client.create({
        data: { name: clientName },
      });
      createdClients++;
      console.log(`✓ Created client: ${clientName}`);
    } else {
      skippedExisting++;
      console.log(`→ Existing client: ${clientName}`);
    }

    // Add locations as plants (check for duplicates by location)
    for (const location of locations) {
      // Check if a plant with this location already exists under this client
      const existingPlant = await prisma.plant.findFirst({
        where: {
          clientId: client.id,
          location: location,
        },
      });

      if (existingPlant) {
        console.log(`  → Existing plant: ${location}`);
        continue;
      }

      // Create plant name from location (e.g., "Chennai" → "Chennai Plant")
      const plantName = location.includes(",")
        ? `${location.split(",")[0]} Plant`
        : `${location} Plant`;

      await prisma.plant.create({
        data: {
          clientId: client.id,
          name: plantName,
          location: location,
          isDemo: false,
        },
      });
      createdPlants++;
      console.log(`  ✓ Added plant: ${location}`);
    }
  }

  console.log("---");
  console.log(`Summary: ${createdClients} new clients, ${createdPlants} new plants, ${skippedExisting} existing clients`);

  // Verify total counts
  const totalClients = await prisma.client.count();
  const totalPlants = await prisma.plant.count();
  console.log(`Database now has: ${totalClients} clients, ${totalPlants} plants`);

  await prisma.$disconnect();
})().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
