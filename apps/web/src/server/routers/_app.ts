import { router } from "../trpc";
import { documentsRouter } from "./documents";
import { apiKeysRouter } from "./apiKeys";
import { documentTypesRouter } from "./documentTypes";

export const appRouter = router({
  documents: documentsRouter,
  apiKeys: apiKeysRouter,
  documentTypes: documentTypesRouter,
});

export type AppRouter = typeof appRouter;
