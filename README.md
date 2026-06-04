# MoneyTree

MoneyTree is an advanced, custom-built AI image generation interface powered by Next.js and React. Designed with a unique, stylized aesthetic, it provides powerful tools for crafting detailed prompts, managing reference images, and organizing your generated outputs.

## Architecture Overview

MoneyTree follows a clean, client-heavy architecture designed for offline-first persistence and modular AI generation:

- **UI & Interaction Layer:** Built entirely with React Client Components in Next.js (App Router), relying on a custom vanilla CSS design system in globals.css.
- **State Management:** Utilizes React Context Providers (ModuleContext, GalleryContext, SettingsContext, StudioContext) to isolate and manage complex UI state across the workspace.
- **Pipeline Logic:** A dedicated src/lib/pipeline layer handles the orchestration of AI generation. It constructs the payload, parses image references, and acts as the bridge to external APIs.
- **Data Persistence:** Powered by a custom IndexedDB wrapper (src/lib/db.ts). To maintain UI performance, heavy image payload data is isolated in a dedicated images table, while lightweight metadata is managed in eferences, projects, and gallery tables, seamlessly re-merging during the initial application load.

## Features

- **Advanced Prompt Builder:** Construct, refine, and sequence your prompts using the interactive HUD.
- **Studio Modules:** Fine-tune reference images (Brief slots) with custom strength settings, blending modes (Subject, Style, Depth), and AI vision descriptions.
- **Integrated Gallery:** View, manage, and retrieve your previously generated images directly from the built-in IndexedDB gallery.
- **Custom Aesthetic:** A highly customized, unique brutalist/vintage UI using carefully tuned typography and layout design.
- **Local Database (IndexedDB):** All your projects, images, and session states are securely stored locally in your browser.

## Getting Started

First, install the dependencies:

`ash
npm install
`

Then, run the development server:

`ash
npm run dev
`

Open [http://localhost:3000](http://localhost:3000) with your browser to see the interface.

## Technology Stack

- **Framework:** Next.js (App Router)
- **Styling:** Custom Vanilla CSS
- **Database:** Local IndexedDB
- **State Management:** React Context API

## License

This project is licensed under the MIT License.
