import { indexVault } from './search.js';

try {
  const stats = await indexVault();
  console.log(`Indexed ${stats.filesFound} Markdown files with ${stats.chunksIndexed} new or updated chunks.`);
  console.log(`Added: ${stats.filesAdded}; updated: ${stats.filesUpdated}; unchanged: ${stats.filesUnchanged}; removed: ${stats.filesDeleted}.`);
  console.log(`Embedding model: ${stats.embeddingModel} (${stats.embeddingDimensions} dimensions).`);
  console.log('Updated vault/index.md with file names, descriptions, and vault-relative paths.');
} catch (error) {
  console.error(`Vault indexing failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
