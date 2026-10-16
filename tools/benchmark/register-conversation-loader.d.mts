export function assertLoadedCandidateModules(root: string, candidate: string, harnessRevision?: string): {
  loadedApplicationModules: number;
  loadedApplicationProof: "PASS";
};
