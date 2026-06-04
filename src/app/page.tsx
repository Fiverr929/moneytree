import PromptBar from "@/components/PromptBar";
import Gallery from "@/components/Gallery";
import HUD from "@/components/HUD";
import TitleBar from "@/components/TitleBar";
import ModulePanel from "@/components/ModulePanel";
import ProjectsModal from "@/components/ProjectsModal";
import SettingsModal from "@/components/SettingsModal";

export default function Home() {
  return (
    <>
      <PromptBar />
      <Gallery />
      <HUD />
      <TitleBar />
      <ModulePanel />
      <ProjectsModal />
      <SettingsModal />
    </>
  );
}

