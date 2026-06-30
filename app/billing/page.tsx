import { AICrewStudio } from "../../components/AICrewStudio";
import { areCreditsEnabled } from "../../lib/feature-flags.js";

export default function Page() {
  return <AICrewStudio initialView={areCreditsEnabled() ? "billing" : "dashboard"} />;
}
