import PromptBar from "@/components/PromptBar";
import Gallery from "@/components/Gallery";
import HUD from "@/components/HUD";
import TitleBar from "@/components/TitleBar";
import ModulePanel from "@/components/ModulePanel";
import ProjectsModal from "@/components/ProjectsModal";
import SettingsModal from "@/components/SettingsModal";
import EvaluationDialog from "@/components/EvaluationDialog";

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "CafeHTML",
  url: "https://cafehtml.net/",
  description:
    "A modular AI image and video workspace for composing references, collaborating with an AI agent, and generating creative media.",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(websiteSchema).replace(/</g, "\\u003c"),
        }}
      />
      <PromptBar />
      <Gallery />
      <HUD />
      <TitleBar />
      <ModulePanel />
      <ProjectsModal />
      <SettingsModal />
      <EvaluationDialog />
    </>
  );
}

