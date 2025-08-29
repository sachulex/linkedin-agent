import { getPacksLocal } from "./knowledge";

type PacksResponse = {
  version: number;
  checksum: string;
  updated_at: string;
  packs: Record<string, any>;
};

export async function getKnowledgePacks(select: string[]): Promise<PacksResponse> {
  // Use in-process data to avoid cross-instance drift and to be lightning fast.
  return getPacksLocal(select);
}
