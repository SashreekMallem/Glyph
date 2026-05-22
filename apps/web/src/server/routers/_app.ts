import { router } from "../trpc";
import { documentsRouter } from "./documents";
import { apiKeysRouter } from "./apiKeys";
import { documentTypesRouter } from "./documentTypes";
import { styleProfilesRouter } from "./styleProfiles";

export const appRouter = router({
  documents: documentsRouter,
  apiKeys: apiKeysRouter,
  documentTypes: documentTypesRouter,
  styleProfiles: styleProfilesRouter,
});

export type AppRouter = typeof appRouter;
