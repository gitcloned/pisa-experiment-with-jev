import { loadAllSections } from "@/lib/questions";
import Link from "next/link";

export default function Home() {
  const sections = loadAllSections();

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">PISA Assessment</h1>
      <p className="text-sm text-gray-500 mb-8">Jev vs Gemini — speed &amp; accuracy comparison</p>
      <div className="w-full max-w-sm flex flex-col gap-3">
        {sections.map((s) => (
          <Link
            key={s.id}
            href={`/exam/${s.id}`}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-400 hover:shadow-sm transition-all"
          >
            <p className="font-semibold text-gray-900">{s.title}</p>
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{s.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
