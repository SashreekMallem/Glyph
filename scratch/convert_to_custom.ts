import { db } from "../apps/web/src/db";
import { documents } from "../apps/web/src/db/schema";
import { eq, desc } from "drizzle-orm";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../apps/web/.env.local") });

async function main() {
  const latest = await db.select().from(documents).orderBy(desc(documents.createdAt)).limit(1);
  if (latest.length > 0) {
    console.log("Latest document:", latest[0].id, latest[0].title, latest[0].documentTypeKey);
    
    await db.update(documents)
      .set({ 
        documentType: "custom", 
        documentTypeKey: "custom" 
      })
      .where(eq(documents.id, latest[0].id));
      
    console.log("Successfully converted to custom document.");
  }
}

main().catch(console.error);
