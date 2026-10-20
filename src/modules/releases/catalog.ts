import source from './catalog.json';
import { ReleaseCatalogSchema } from '@/contracts/api/product-updates';
/** The bundle's release catalogue, never a claim about an active Worker version. */
export const releaseCatalog = ReleaseCatalogSchema.parse(source);
