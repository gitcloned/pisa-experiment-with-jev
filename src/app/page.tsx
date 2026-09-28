import { loadAllSections, loadQuestions } from "@/lib/questions";
import Link from "next/link";
import Image from "next/image";
import { auth } from "@/auth";
import { SignInBanner, SignInModal } from "@/components/SignInGate";

export default async function Home() {
  const session = await auth();
  const sections = loadAllSections();
  const sectionsWithCount = sections.map((s) => ({
    ...s,
    questionCount: loadQuestions(s.id).length,
  }));

  return (
    <main className="min-h-screen bg-gray-50">
      <SignInBanner session={session} />
      {!session && <SignInModal />}

      {/* Section cards */}
      <div className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1 pt-2">Choose a section</p>
        {sectionsWithCount.map((s) => (
          <div key={s.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            {s.imageFile && (
              <div className="w-full h-36 bg-gray-100 relative overflow-hidden">
                <Image
                  src={`/exams/${s.id}/${s.imageFile}`}
                  alt={s.imageAlt ?? s.title}
                  fill
                  sizes="(max-width: 512px) 100vw, 512px"
                  className="object-cover object-top"
                />
              </div>
            )}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3 mb-1">
                <p className="font-semibold text-gray-900">{s.title}</p>
                <span className="shrink-0 text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                  {s.questionCount} question{s.questionCount !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="text-xs text-gray-400 line-clamp-2 mb-4">{s.description}</p>
              <Link
                href={`/exam/${s.id}`}
                className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 font-semibold text-sm transition-colors"
              >
                Start →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
