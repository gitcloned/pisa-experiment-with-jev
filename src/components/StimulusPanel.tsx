import type { Section } from "@/types";
import Image from "next/image";

interface Props {
  section: Section;
  compact?: boolean;
}

export default function StimulusPanel({ section, compact }: Props) {
  return (
    <div className={compact ? "p-4" : "p-6 md:p-8 h-full"}>
      <p className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-4">
        {section.title}
      </p>

      {section.imageFile && (
        <div className="mb-4 rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
          <Image
            src={`/exams/${section.id}/${section.imageFile}`}
            alt={section.imageAlt ?? section.title}
            width={600}
            height={300}
            className="w-full object-contain"
            priority
          />
        </div>
      )}

      <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
        {section.description}
      </div>
    </div>
  );
}
