"use client";

import { useState, useRef } from "react";
import type { Question } from "@/types";

interface Props {
  question: Question;
  onSubmit: (answerText: string, answerImage?: string) => void;
  onClose: () => void;
}

export default function AnswerModal({ question, onSubmit, onClose }: Props) {
  const [tab, setTab] = useState<"write" | "photo">("write");
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl);
      // Compress: resize to max 1024px wide, JPEG at 0.75 quality
      const img = new window.Image();
      img.onload = () => {
        const MAX = 1024;
        const scale = img.width > MAX ? MAX / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL("image/jpeg", 0.75);
        setImageBase64(compressed.split(",")[1]);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function handleSubmit() {
    if (tab === "write" && text.trim()) {
      onSubmit(text.trim());
    } else if (tab === "photo" && imageBase64) {
      onSubmit("", imageBase64);
    }
  }

  const canSubmit = tab === "write" ? text.trim().length > 0 : imageBase64 !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-blue-600 px-5 py-4 md:rounded-t-2xl rounded-t-2xl flex justify-between items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-blue-200 mb-1">Answer</p>
            <p className="text-sm font-semibold text-white leading-snug line-clamp-2">
              {question.stem}
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none mt-0.5 shrink-0">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {(["write", "photo"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === t
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "write" ? "✏️ Write" : "📷 Photo"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 flex-1 overflow-y-auto">
          {tab === "write" ? (
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Write your working and answer here…\n\nE.g:\nn/P = 140\n70/P = 140\nP = 0.5 m"}
              className="w-full h-48 border border-gray-200 rounded-xl p-4 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
            />
          ) : (
            <div>
              {imagePreview ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="Answer" className="w-full rounded-xl border border-gray-200" />
                  <button
                    onClick={() => { setImagePreview(null); setImageBase64(null); }}
                    className="absolute top-2 right-2 bg-white rounded-full w-7 h-7 flex items-center justify-center shadow text-gray-600 hover:text-red-500"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full h-48 border-2 border-dashed border-blue-300 rounded-xl flex flex-col items-center justify-center gap-3 bg-blue-50 hover:bg-blue-100 transition-colors"
                >
                  <span className="text-4xl">📷</span>
                  <span className="text-sm font-semibold text-blue-600">Take a photo of your work</span>
                  <span className="text-xs text-gray-400">Handwritten working, diagrams, calculations</span>
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {!imagePreview && (
                <button
                  onClick={() => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFile(f); }; i.click(); }}
                  className="w-full mt-3 text-sm text-gray-500 underline text-center"
                >
                  or upload from gallery
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 pt-0 flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl py-3 font-semibold text-sm transition-colors"
          >
            Submit Answer
          </button>
          <button
            onClick={onClose}
            className="border border-gray-200 rounded-xl px-5 py-3 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
