import Parser from "web-tree-sitter";
import type { TreeSitterGrammar } from "../shared/messages";

/**
 * Path inside `public/` where grammar WASM files are copied during install.
 * See `apps/web/scripts/copy-ts-wasm.mjs`.
 */
export const GRAMMAR_PUBLIC_PREFIX = "/tree-sitter";

const GRAMMAR_FILES: Record<TreeSitterGrammar, string | null> = {
  // MVP ships markdown only. `html` and `plain` are reserved — emitting an
  // error for those is the graceful-degradation path.
  markdown: "tree-sitter-markdown.wasm",
  html: null,
  plain: null,
};

export const grammarWasmPath = (grammar: TreeSitterGrammar): string | null => {
  const file = GRAMMAR_FILES[grammar];
  if (!file) return null;
  return `${GRAMMAR_PUBLIC_PREFIX}/${file}`;
};

let parserReady: Promise<void> | null = null;

export const ensureParserInit = async (): Promise<void> => {
  if (parserReady) return parserReady;
  parserReady = Parser.init({
    locateFile: (name: string) => `${GRAMMAR_PUBLIC_PREFIX}/${name}`,
  });
  try {
    await parserReady;
  } catch (err) {
    parserReady = null;
    throw err;
  }
};

// Cache languages by grammar name — each is ~hundreds of KB of WASM.
const languageCache = new Map<TreeSitterGrammar, Parser.Language>();

export const loadGrammar = async (
  grammar: TreeSitterGrammar,
): Promise<Parser.Language> => {
  const cached = languageCache.get(grammar);
  if (cached) return cached;

  const path = grammarWasmPath(grammar);
  if (!path) {
    throw new Error(`grammar '${grammar}' is not bundled`);
  }

  await ensureParserInit();
  const language = await Parser.Language.load(path);
  languageCache.set(grammar, language);
  return language;
};

export const __resetGrammarsForTests = (): void => {
  parserReady = null;
  languageCache.clear();
};
