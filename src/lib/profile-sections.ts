export function getProfileSections(role: "CLIPPER" | "MODERATOR") {
  return { payoutDetails: role === "CLIPPER", telegram: true };
}
