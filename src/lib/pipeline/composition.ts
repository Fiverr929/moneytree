/* eslint-disable @typescript-eslint/no-explicit-any */
// composition.ts
export type CompositionItem = {
  kind: 'image' | 'text';
  source: 'module' | 'reference';
  role: string;
  slot: string | null;
  section: string;
  layerName: string;
  desc?: string | null;
  imgUrl?: string;
  uuid?: string | null;
  strength?: number;
  text?: string;
  inline?: boolean;
  position?: number;
};

export function buildComposition(payload: any, files?: any[]): CompositionItem[] {
  const moduleItems: CompositionItem[] = [];
  let position = 1;

  if (files) {
    // New simplified Next.js pipeline: consume files directly
    const sectionMap = {
      'SUBJECT': 'subject',
      'STAGE': 'stage',
      'STYLE': 'style'
    };

    files.forEach(f => {
      if (!f.url || !f.eye) return;
      const section = sectionMap[f.folder as keyof typeof sectionMap] || 'reference';
      moduleItems.push({
        kind: 'image',
        source: section === 'reference' ? 'reference' : 'module',
        role: f.label || f.name || 'IMAGE',
        slot: null, // Next.js version doesn't use slots yet
        section,
        layerName: f.label || f.name || 'IMAGE',
        desc: f.visionDesc || null,
        imgUrl: f.url,
        uuid: f.uuid,
        strength: f.strength ?? 50
      });
    });
  } else {
    // Legacy pipeline compatibility
    function fromReferences(refs: any[]) {
      (refs || []).forEach(ref => {
        if (!ref || !ref.imgUrl) return;
        moduleItems.push({
          kind: 'image',
          source: 'reference',
          role: ref.role || 'REFERENCE',
          slot: null,
          section: 'reference',
          layerName: ref.role || 'REFERENCE',
          desc: ref.visionDesc || null,
          imgUrl: ref.imgUrl,
          uuid: ref.uuid || null,
          strength: ref.strength == null ? 50 : ref.strength
        });
      });
    }

    function fromSection(section: any, sectionName: string) {
      if (!section || !section.slots) return;
      section.slots.forEach((slot: any) => {
        if (!slot.active) return;
        const slotLabel = slot.label || '?';
        (slot.layers || []).forEach((layer: any) => {
          if (!layer.visible) return;
          const imageChildren = layer.children.filter((c: any) => c.visible && c.type === 'image' && c.imgUrl);
          const total = imageChildren.length;
          layer.children.forEach((child: any) => {
            if (!child.visible) return;
            if (child.type === 'image' && child.imgUrl) {
              const idx = imageChildren.indexOf(child);
              const desc = child.visionDesc || null;
              const angleNote = total > 1 ? ` (view ${idx + 1} of ${total} — same subject)` : '';
              moduleItems.push({
                kind: 'image',
                source: 'module',
                role: layer.name || 'LAYER',
                slot: slotLabel,
                section: slot.section || sectionName,
                layerName: layer.name || 'LAYER',
                desc: desc ? desc + angleNote : null,
                imgUrl: child.imgUrl,
                uuid: child.uuid || null,
                strength: child.strength == null ? 50 : child.strength
              });
            } else if (child.type === 'prompt' && child.text) {
              moduleItems.push({
                kind: 'text',
                source: 'module',
                role: layer.name || 'LAYER',
                slot: slotLabel,
                section: slot.section || sectionName,
                layerName: layer.name || 'LAYER',
                text: child.text
              });
            }
          });
        });
      });
    }

    fromSection(payload.subject, 'subject');
    fromSection(payload.stage, 'stage');
    fromSection(payload.style, 'style');
    fromReferences(payload.refs);
  }

  const items = moduleItems;
  items.forEach(item => {
    if (item.kind === 'image') {
      item.inline = !item.desc;
      if (item.inline) {
        item.position = position++;
      }
    }
  });

  return items;
}


